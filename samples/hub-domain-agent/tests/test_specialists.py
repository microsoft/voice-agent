"""Independent Billing and Booking behavior, packaging and snapshot lifecycle."""

import importlib
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from helpers import Stream, collect, direct, tool
from starlette.testclient import TestClient

import common.runtime as shared
import deploy
from common.config import Config

ENDPOINT = "https://sample.invalid/api/projects/test"
ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(params=["billing", "booking"])
def implementation(request):
    module = importlib.import_module(request.param + ".agent")
    cls = getattr(module, request.param.title() + "Agent")
    return request.param, module, cls


@pytest.fixture
async def specialist(implementation):
    role, module, cls = implementation
    runtime = cls(Config(ENDPOINT, "text-model"), warmup=False)
    runtime.session_id = role + "-one"
    runtime.credential = NS(close=AsyncMock())
    runtime.project = NS(close=AsyncMock())
    runtime.model = NS(responses=NS(create=AsyncMock()), close=AsyncMock())
    runtime.http = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: pytest.fail("No child-session HTTP")))
    yield role, module, runtime
    await runtime.close_clients()


async def test_specialist_uses_only_its_own_prompt_and_no_hub_tools(specialist):
    role, module, runtime = specialist
    runtime.model.responses.create.side_effect = [Stream(direct("First answer")), Stream(direct("Second answer"))]
    assert (await collect(runtime, "Question one"))[-1]["type"] == "done"
    assert (await collect(runtime, "Follow-up"))[-1]["type"] == "done"
    assert runtime.role == role and runtime.prompt == module.PROMPT
    assert not hasattr(runtime, "ensure_domain") and not hasattr(runtime, "prefetch")
    assert runtime.owned_sessions() == {} and not hasattr(runtime.config, "domains")
    assert len(runtime.history) == 4
    calls = runtime.model.responses.create.call_args_list
    assert all(call.kwargs["instructions"] == module.PROMPT for call in calls)
    assert all("tools" not in call.kwargs and "tool_choice" not in call.kwargs for call in calls)
    assert calls[1].kwargs["input"][:2] == runtime.history[:2]


@pytest.mark.parametrize("events", [tool(), direct()[:-1], [NS(type="response.failed")]])
async def test_specialist_rejects_tools_and_incomplete_model_stream(specialist, events):
    _, _, runtime = specialist
    runtime.model.responses.create.return_value = Stream(events)
    assert (await collect(runtime))[-1]["type"] == "error"
    assert runtime.history == [] and runtime.owned_sessions() == {}


async def test_specialist_generator_close_drains_model_without_committing(specialist):
    _, _, runtime = specialist
    stream = Stream(direct("Partial"))
    runtime.model.responses.create.return_value = stream
    output = runtime.stream("Question")
    assert b"Partial" in await anext(output)
    await output.aclose()
    assert stream.closed and not runtime.history and not runtime.lock.locked()


async def test_specialist_warmup_is_optional_and_never_enters_history(specialist):
    role, module, runtime = specialist
    runtime.model_warmup = True
    runtime.start_warmup()
    await runtime.warmup_task
    call = runtime.model.responses.create.call_args
    assert call.kwargs["instructions"] == module.PROMPT
    assert call.kwargs["input"] == "Hello" and call.kwargs["store"] is False
    assert runtime.role == role and runtime.history == []
    await runtime.quiesce()


def test_each_specialist_exposes_its_own_real_sdk_hooks(implementation, monkeypatch):
    role, module, _ = implementation
    monkeypatch.setenv("FOUNDRY_PROJECT_ENDPOINT", ENDPOINT)
    monkeypatch.setattr(shared, "DefaultAzureCredential", lambda: NS(close=AsyncMock()))
    monkeypatch.setattr(
        shared,
        "AIProjectClient",
        lambda **_: NS(get_openai_client=MagicMock(return_value=NS(close=AsyncMock())), close=AsyncMock()),
    )
    server, runtime = module.create_app(Config(ENDPOINT, "model"), warmup=False, configure_observability=None)
    with TestClient(server) as client:
        assert client.post("/_before_snapshot", json={}).status_code == 200
        body = {"session_context": {"session_id": role + "-restored", "restore_id": "restore-one"}}
        assert client.post("/_after_restore", json=body).status_code == 200
        status = client.post("/invocations", json={"action": "status"}).json()
        assert status["role"] == role and status["captured"]
        assert status["restore_id"] == "restore-one" and status["sessions"] == {}
    assert runtime.model is None


@pytest.mark.parametrize("role", ["hub", "billing", "booking"])
def test_each_image_and_entry_point_contains_only_its_business_implementation(role):
    docker = (ROOT / role / "Dockerfile").read_text()
    assert "COPY common/*.py" in docker and f"COPY {role}/*.py" in docker
    assert f'CMD ["python", "-m", "{role}.main"]' in docker
    for other in {"hub", "billing", "booking"} - {role}:
        assert f"COPY {other}/" not in docker
        assert f"from {other}." not in (ROOT / role / "agent.py").read_text()
    assert (ROOT / role / "prompts.py").exists()
    assert not (ROOT / "agent.py").exists() and not (ROOT / "prompts.py").exists()
    assert "AGENT_ROLE" not in (ROOT / role / "main.py").read_text()


def test_deployment_record_points_to_three_distinct_images():
    images = {
        role: f"registry.invalid/{role}@sha256:" + code * 64
        for role, code in (("hub", "a"), ("billing", "b"), ("booking", "c"))
    }
    refs = {role: {"name": role + "-agent", "version": "3"} for role in images}
    bodies = {role: deploy.definition(ENDPOINT, image, "model", role, refs).as_dict() for role, image in images.items()}
    assert len({value["container_configuration"]["image"] for value in bodies.values()}) == 3
    assert all("AGENT_ROLE" not in value["environment_variables"] for value in bodies.values())
    assert "DOMAIN_MODEL_WARMUP" not in bodies["hub"]["environment_variables"]
    assert bodies["billing"]["environment_variables"]["DOMAIN_MODEL_WARMUP"] == "true"
    assert bodies["booking"]["environment_variables"]["DOMAIN_MODEL_WARMUP"] == "true"
