"""Deployment serialization, snapshot failures and session ownership guards; no cloud traffic."""

import json
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from azure.core.exceptions import ResourceNotFoundError

import common.records as records
import common.runtime as shared
import deploy
import smoke
from billing.agent import BillingAgent
from common.config import Config, project_endpoint

ENDPOINT = "https://sample.invalid/api/projects/test"
IMAGE = "registry.invalid/sample@sha256:" + "a" * 64
IMAGES = {
    "hub": IMAGE,
    "billing": "registry.invalid/billing@sha256:" + "b" * 64,
    "booking": "registry.invalid/booking@sha256:" + "c" * 64,
}


def deployment():
    return {
        "project_endpoint": ENDPOINT,
        "agents": {role: {"name": role + "-agent", "version": "3"} for role in ("hub", "billing", "booking")},
    }


def test_typed_definition_serializes_snapshot_protocol_and_domain_versions():
    body = deploy.definition(ENDPOINT, IMAGE, "my-deployment", "hub", deployment()["agents"]).as_dict()
    assert body["enable_memory_snapshot"] is True
    assert body["protocol_versions"] == [{"protocol": "invocations", "version": "2.0.0"}]
    assert body["session_configuration"] == {"idle_timeout_seconds": 120}
    assert body["cpu"] == "1" and body["memory"] == "2Gi"
    assert body["container_configuration"]["image"] == IMAGE
    environment = body["environment_variables"]
    assert environment["BILLING_DOMAIN_AGENT"] == "billing-agent"
    assert environment["BILLING_DOMAIN_VERSION"] == environment["BOOKING_DOMAIN_VERSION"] == "3"


@pytest.mark.parametrize("role", ["billing", "booking"])
def test_specialist_definition_uses_its_own_image_without_role_switch_or_hub_bindings(role):
    body = deploy.definition(ENDPOINT, IMAGES[role], "model", role, {}).as_dict()
    assert body["enable_memory_snapshot"] and body["container_configuration"]["image"] == IMAGES[role]
    assert "AGENT_ROLE" not in body["environment_variables"]
    assert "DOMAIN_SPECIALTY" not in body["environment_variables"]
    assert "BILLING_DOMAIN_AGENT" not in body["environment_variables"]


def test_create_deploys_domains_before_hub_and_preserves_partial_manifest(tmp_path):
    client = NS(agents=MagicMock())
    client.agents.get.side_effect = ResourceNotFoundError("not found")
    definitions = {}

    def create(**kwargs):
        definitions[kwargs["agent_name"]] = kwargs["definition"]
        return NS(version="1")

    def version(**kwargs):
        return NS(as_dict=lambda: {"status": "active"}, definition=definitions[kwargs["agent_name"]])

    client.agents.create_version.side_effect = create
    client.agents.get_version.side_effect = version
    result = deploy.create(client, ENDPOINT, IMAGES, "model", "sample", tmp_path / "deployment.json")
    assert list(result["agents"]) == ["billing", "booking", "hub"]
    hub = definitions[result["agents"]["hub"]["name"]].as_dict()
    assert hub["environment_variables"]["BILLING_DOMAIN_AGENT"] == result["agents"]["billing"]["name"]
    assert hub["environment_variables"]["BILLING_DOMAIN_VERSION"] == "1"
    assert all(
        call.kwargs["metadata"]["voiceLiveInvocationState"] == "session_self_managed"
        for call in client.agents.create_version.call_args_list
    )
    assert not client.agents.update.called and not client.agents.delete.called
    assert json.loads((tmp_path / "deployment.json").read_text()) == result


def test_failed_create_keeps_planned_names_and_accepted_versions(tmp_path):
    client = NS(agents=MagicMock())
    client.agents.get.side_effect = ResourceNotFoundError("not found")
    body = deploy.definition(ENDPOINT, IMAGES["billing"], "model", "billing", {})
    client.agents.get_version.return_value = NS(as_dict=lambda: {"status": "active"}, definition=body)
    client.agents.create_version.side_effect = [NS(version="1"), RuntimeError("controlled failure")]
    output = tmp_path / "partial.json"
    with pytest.raises(RuntimeError, match="controlled failure"):
        deploy.create(client, ENDPOINT, IMAGES, "model", "sample", output)
    record = json.loads(output.read_text())
    assert set(record["planned_names"]) == {"hub", "billing", "booking"}
    assert set(record["agents"]) == {"billing"}


@pytest.mark.parametrize("fail_at", range(1, 8))
def test_interrupted_deployment_checkpoint_keeps_previous_json_and_stops_creates(tmp_path, monkeypatch, fail_at):
    client = NS(agents=MagicMock())
    client.agents.get.side_effect = ResourceNotFoundError("not found")
    definitions = {}

    def create(**kwargs):
        definitions[kwargs["agent_name"]] = kwargs["definition"]
        return NS(version="1")

    client.agents.create_version.side_effect = create
    client.agents.get_version.side_effect = lambda **kwargs: NS(
        as_dict=lambda: {"status": "active"}, definition=definitions[kwargs["agent_name"]]
    )
    output = tmp_path / "deployment.json"
    count, previous = 0, None
    real_write = type(output).write_text
    real_dump = records.json.dump

    def interrupt():
        nonlocal count, previous
        count += 1
        if count == fail_at:
            previous = output.read_bytes() if output.exists() else None
            return True
        return False

    def write_text(path, text, *args, **kwargs):
        if interrupt():
            real_write(path, text[:7], *args, **kwargs)
            raise InterruptedError("interrupted checkpoint")
        return real_write(path, text, *args, **kwargs)

    def dump(value, stream, *args, **kwargs):
        if interrupt():
            stream.write('{"cut":')
            raise InterruptedError("interrupted checkpoint")
        return real_dump(value, stream, *args, **kwargs)

    monkeypatch.setattr(type(output), "write_text", write_text)
    monkeypatch.setattr(records.json, "dump", dump)
    with pytest.raises(InterruptedError, match="interrupted checkpoint"):
        deploy.create(client, ENDPOINT, IMAGES, "model", "sample", output)
    assert client.agents.create_version.call_count == fail_at // 2
    assert client.agents.get_version.call_count == (fail_at - 1) // 2
    if previous is None:
        assert not output.exists()
    else:
        assert output.read_bytes() == previous
        assert set(json.loads(output.read_text())["planned_names"]) == {"hub", "billing", "booking"}
    assert list(tmp_path.iterdir()) == ([output] if previous is not None else [])
    before_retry = client.agents.create_version.call_count
    if previous is not None:
        with pytest.raises(FileExistsError):
            deploy.create(client, ENDPOINT, IMAGES, "model", "sample", output)
        assert client.agents.create_version.call_count == before_retry
    else:
        result = deploy.create(client, ENDPOINT, IMAGES, "model", "sample", output)
        assert json.loads(output.read_text()) == result and len(result["agents"]) == 3


@pytest.mark.parametrize(
    "image,prefix,idle",
    [("image:latest", "sample", 120), (IMAGE, "../bad", 120), (IMAGE, "sample", 119), (IMAGE, "sample", 3601)],
)
def test_invalid_deployment_inputs_do_not_write_cloud_resources(tmp_path, image, prefix, idle):
    client = NS(agents=MagicMock())
    with pytest.raises(ValueError):
        deploy.create(
            client, ENDPOINT, {**IMAGES, "hub": image}, "model", prefix, tmp_path / "deployment.json", idle=idle
        )
    client.agents.create_version.assert_not_called()


@pytest.mark.parametrize("stage", ["fsync", "replace"])
def test_atomic_checkpoint_finalization_failure_preserves_previous_record_and_can_retry(tmp_path, monkeypatch, stage):
    output = tmp_path / "deployment.json"
    records.write_report(output, {"planned_names": {"hub": "owned"}})
    before = output.read_bytes()
    original = getattr(records.os, stage)

    def fail(*_):
        raise OSError("finalization failed")

    monkeypatch.setattr(records.os, stage, fail)
    with pytest.raises(OSError, match="finalization failed"):
        records.write_report(output, {"agents": {"hub": {"name": "owned", "version": "1"}}})
    assert output.read_bytes() == before and list(tmp_path.iterdir()) == [output]
    monkeypatch.setattr(records.os, stage, original)
    expected = {"agents": {"hub": {"name": "owned", "version": "1"}}}
    records.write_report(output, expected)
    assert json.loads(output.read_text()) == expected and list(tmp_path.iterdir()) == [output]


def test_existing_agent_is_not_overwritten(tmp_path):
    client = NS(agents=MagicMock())
    with pytest.raises(RuntimeError, match="existing agent"):
        deploy.create(client, ENDPOINT, IMAGES, "model", "sample", tmp_path / "deployment.json")
    client.agents.create_version.assert_not_called()


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://sample/api/projects/p",
        "https://user:password@sample/api/projects/p",
        "https://sample/",
        "https://sample/api/projects/p?query=1",
    ],
)
def test_project_endpoint_rejects_unsafe_or_wrong_shapes(endpoint):
    with pytest.raises(ValueError):
        project_endpoint(endpoint)


async def test_cleanup_refuses_mismatched_version_without_deleting():
    calls = []

    def handler(request):
        calls.append(request.method)
        return httpx.Response(200, json={"version_indicator": {"agent_version": "99"}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ExceptionGroup):
            await smoke.cleanup(client, deployment(), "billing", "owned", {})
    assert calls == ["GET"]


async def test_capture_close_failure_is_not_reported_as_success():
    runtime = BillingAgent(Config(ENDPOINT, "model"), warmup=False)
    runtime.model = NS(close=AsyncMock(side_effect=RuntimeError("close failed")))
    with pytest.raises(RuntimeError, match="close failed"):
        await runtime.before_snapshot()
    assert not runtime.captured


async def test_restore_failure_closes_partial_clients_and_keeps_retry_possible(monkeypatch):
    runtime = BillingAgent(Config(ENDPOINT, "model"), warmup=False)
    runtime.captured = True
    credential = NS(close=AsyncMock())
    project = NS(get_openai_client=MagicMock(side_effect=RuntimeError("controlled")), close=AsyncMock())
    monkeypatch.setattr(shared, "DefaultAzureCredential", lambda: credential)
    monkeypatch.setattr(shared, "AIProjectClient", lambda **_: project)
    with pytest.raises(RuntimeError, match="controlled"):
        await runtime.after_restore(NS(session_id="one", restore_id="restore-one", session_env_overrides={}))
    assert runtime.restore_id is None and runtime.session_id is None
    credential.close.assert_awaited_once()
    project.close.assert_awaited_once()


async def test_turn_timeout_becomes_error_without_committing_history(monkeypatch):
    runtime = BillingAgent(Config(ENDPOINT, "model"), warmup=False)
    monkeypatch.setattr(shared, "TURN_TIMEOUT_SECONDS", 0)
    runtime.model = NS(responses=NS(create=AsyncMock()))
    runtime.credential, runtime.project, runtime.http = object(), object(), object()
    frames = [frame async for frame in runtime.stream("Question")]
    assert json.loads(frames[-1][6:])["type"] == "error"
    assert runtime.history == []
