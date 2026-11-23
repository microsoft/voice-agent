"""Real runtime, SSE and SDK routes; only model, identity and Domain network are substituted."""

import asyncio
import hashlib
import json
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, MagicMock

import anyio
import httpx
import pytest
from azure.ai.agentserver.core import AgentSessionContext
from helpers import Stream, collect, direct, tool
from openai import AsyncOpenAI
from starlette.testclient import TestClient

import common.protocol as protocol
import common.runtime as shared
import hub.agent as agent
import smoke
from hub.config import DomainReference, HubConfig

ENDPOINT = "https://sample.invalid/api/projects/test"


def config():
    domains = {name: DomainReference(name + "-agent", "3") for name in ("billing", "booking")}
    return HubConfig(ENDPOINT, "text-model", domains)


@pytest.fixture
async def runtime():
    value = agent.HubAgent(config())
    value.session_id = "hub-one"
    value.credential = NS(get_token=AsyncMock(return_value=NS(token="test-token")), close=AsyncMock())
    value.project = NS(close=AsyncMock())
    value.model = NS(responses=NS(create=AsyncMock()), close=AsyncMock())
    value.http = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: pytest.fail("Unexpected external request")))
    yield value
    await value.close_clients()


def install_domain(runtime, *, payload=None, create_status=200, version="3"):
    requests = []

    async def handler(request):
        requests.append(request)
        if request.url.path.endswith("/sessions"):
            return httpx.Response(
                create_status, json={"status": "active", "version_indicator": {"agent_version": version}}
            )
        if request.method == "DELETE":
            return httpx.Response(204)
        content = (
            payload
            if payload is not None
            else protocol.sse({"type": "output_audio_transcription.delta", "delta": "30 yuan"})
            + protocol.sse({"type": "done"})
        )
        return httpx.Response(200, content=content, headers={"content-type": "text/event-stream"})

    runtime.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return requests


async def test_self_answer_streams_and_commits_completed_history_without_domain(runtime):
    streams = [Stream(direct()), Stream(direct("How can I help?"))]
    runtime.model.responses.create.side_effect = streams
    assert (await collect(runtime, "Hello"))[-1]["type"] == "done"
    await collect(runtime, "What can you do?")
    assert runtime.last_route == "self" and not runtime.sessions
    assert len(runtime.history) == 4
    assert runtime.model.responses.create.call_args_list[1].kwargs["input"][:2] == runtime.history[:2]
    assert all(stream.closed for stream in streams)
    assert runtime.model.responses.create.call_args.kwargs["parallel_tool_calls"] is False


@pytest.mark.parametrize("role", ["billing", "booking"])
async def test_delegate_preserves_raw_input_and_reuses_version_pinned_domain(runtime, role):
    requests = install_domain(runtime)
    runtime.model.responses.create.side_effect = [Stream(tool(role)), Stream(tool(role))]
    original = "  Explain those extra charges, please!  "
    assert (await collect(runtime, original))[-1]["type"] == "done"
    sid = runtime.sessions[role]
    await collect(runtime, "And the calculation?")
    creates = [request for request in requests if request.url.path.endswith("/sessions")]
    invokes = [request for request in requests if request.url.path.endswith("/invocations")]
    assert len(creates) == 1 and len(invokes) == 2
    assert json.loads(creates[0].content)["version_indicator"]["agent_version"] == "3"
    assert json.loads(invokes[0].content) == {"input": original}
    assert all(request.url.params["agent_session_id"] == sid for request in invokes)
    assert runtime.last_route == role and len(runtime.history) == 4


@pytest.mark.parametrize(
    "events",
    [
        tool(arguments='{"question":"rewritten"}'),
        tool(arguments="[]"),
        tool(arguments="null"),
        tool(arguments="not-json"),
        tool("unknown"),
        tool()[:-1],
        [*direct("Preamble")[:-1], *tool()],
        [*tool()[:-1], *tool()],
        [NS(type="response.failed")],
        [NS(type="response.incomplete")],
    ],
)
async def test_invalid_or_incomplete_tool_output_never_dispatches_business_input(runtime, events):
    requests = install_domain(runtime)
    runtime.model.responses.create.return_value = Stream(events)
    result = await collect(runtime)
    assert result[-1]["type"] == "error"
    assert not runtime.history
    assert not any(request.url.path.endswith("/invocations") for request in requests)


@pytest.mark.parametrize(
    "payload",
    [
        protocol.sse({"type": "output_audio_transcription.delta", "delta": "Partial"}),
        b'data: {"type":"done"}',
        protocol.sse({"type": "error"}),
        protocol.sse({"type": "done"}),
        protocol.sse({"type": "done"}) + protocol.sse({"type": "output_audio_transcription.delta", "delta": "late"}),
    ],
)
async def test_bad_domain_stream_does_not_commit_history(runtime, payload):
    install_domain(runtime, payload=payload)
    runtime.model.responses.create.return_value = Stream(tool())
    assert (await collect(runtime))[-1]["type"] == "error"
    assert runtime.history == []


async def test_prefetch_overlaps_model_stream_but_business_waits_for_completion(runtime):
    created, finish_model = asyncio.Event(), asyncio.Event()
    requests = []

    async def handler(request):
        requests.append(request)
        if request.url.path.endswith("/sessions"):
            created.set()
            return httpx.Response(200, json={"status": "active", "version_indicator": {"agent_version": "3"}})
        assert finish_model.is_set()
        return httpx.Response(
            200,
            content=protocol.sse({"type": "output_audio_transcription.delta", "delta": "Answer"})
            + protocol.sse({"type": "done"}),
            headers={"content-type": "text/event-stream"},
        )

    class Gated(Stream):
        async def __aiter__(self):
            yield self.events[0]
            await finish_model.wait()
            for event in self.events[1:]:
                yield event

    runtime.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    runtime.model.responses.create.return_value = Gated(tool())
    task = asyncio.create_task(collect(runtime))
    await asyncio.wait_for(created.wait(), 5)
    assert len(requests) == 1
    finish_model.set()
    assert (await task)[-1]["type"] == "done"
    assert len(requests) == 2


@pytest.mark.parametrize("level_cancel", [False, True])
async def test_cancellation_drains_prefetch_retains_owned_id_and_does_not_commit(runtime, level_cancel):
    started, cancelled = asyncio.Event(), asyncio.Event()

    async def handler(_):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    class Blocked(Stream):
        async def __aiter__(self):
            yield self.events[0]
            await asyncio.Event().wait()

    runtime.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    runtime.model.responses.create.return_value = Blocked(tool())
    if level_cancel:
        async with anyio.create_task_group() as group:
            group.start_soon(collect, runtime)
            await asyncio.wait_for(started.wait(), 5)
            group.cancel_scope.cancel()
    else:
        task = asyncio.create_task(collect(runtime))
        await asyncio.wait_for(started.wait(), 5)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert cancelled.is_set() and "billing" in runtime.sessions
    assert runtime.history == []


@pytest.mark.parametrize("version,create_status", [("99", 200), ("3", 403), ("3", 500)])
async def test_domain_create_failure_retains_owned_session_and_does_not_dispatch(runtime, version, create_status):
    requests = install_domain(runtime, version=version, create_status=create_status)
    runtime.model.responses.create.return_value = Stream(tool())
    assert (await collect(runtime))[-1]["type"] == "error"
    assert "billing" in runtime.sessions and "billing" not in runtime.ready
    assert all(not request.url.path.endswith("/invocations") for request in requests)


@pytest.mark.parametrize("status", [400, 401, 403, 404, 429])
@pytest.mark.parametrize("clean_first", [False, True])
async def test_definitive_create_rejection_allows_later_corrected_request(runtime, status, clean_first):
    calls, resources = [], set()
    reject = True

    def handler(request):
        calls.append(request)
        if request.method == "POST":
            if reject:
                return httpx.Response(status)
            sid = json.loads(request.content)["agent_session_id"]
            resources.add(sid)
            return httpx.Response(200, json={"status": "active", "version_indicator": {"agent_version": "3"}})
        sid = request.url.path.rsplit("/", 1)[-1]
        if request.method == "GET":
            return (
                httpx.Response(200, json={"version_indicator": {"agent_version": "3"}})
                if sid in resources
                else httpx.Response(404)
            )
        assert request.method == "DELETE"
        resources.remove(sid)
        return httpx.Response(204)

    runtime.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(httpx.HTTPStatusError):
        await runtime.ensure_domain("billing")
    assert not runtime.unresolved_creates and not runtime.ready
    assert len(calls) == 1  # No automatic retry of the rejected request.
    if clean_first:
        await runtime.cleanup()
        assert not runtime.sessions
    reject = False  # A later user request after permissions/configuration/throttling recover.
    sid = await runtime.ensure_domain("billing")
    assert resources == {sid} and runtime.ready == {"billing"}
    await runtime.cleanup()
    assert not resources and not runtime.sessions and not runtime.unresolved_creates
    assert len([r for r in calls if r.method == "POST"]) == 2


async def test_cleanup_deletes_exact_owned_sessions_only_and_retains_failed_ids(runtime):
    runtime.sessions = {"billing": "owned-billing", "booking": "owned-booking"}
    runtime.ready = {"billing", "booking"}
    urls = []

    def handler(request):
        urls.append(str(request.url))
        return httpx.Response(500 if "owned-billing" in str(request.url) else 404)

    runtime.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(ExceptionGroup):
        await runtime.cleanup()
    assert runtime.sessions == {"billing": "owned-billing"} and runtime.ready == {"billing"}
    assert len(urls) == 2 and all("owned-" in url for url in urls)


async def test_conflicting_version_is_not_deleted_and_remains_in_ownership_report(runtime):
    requests = []

    def handler(request):
        requests.append(request)
        if "/agents/booking-agent/" in request.url.path:
            return httpx.Response(404)
        if request.method == "POST":
            return httpx.Response(409)
        assert request.method == "GET"
        return httpx.Response(200, json={"status": "active", "version_indicator": {"agent_version": "99"}})

    runtime.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(RuntimeError, match="version mismatch"):
        await runtime.ensure_domain("billing")
    with pytest.raises(ExceptionGroup):
        await runtime.cleanup()
    assert "billing" in runtime.sessions and "billing" not in runtime.ready
    assert [request.method for request in requests] == ["POST", "GET", "GET", "GET"]
    assert requests[1].url.path == requests[2].url.path


async def test_cleanup_checks_pinned_version_before_deleting_exact_domain(runtime):
    runtime.sessions = {"billing": "owned-billing"}
    runtime.ready = {"billing"}
    requests = []

    def handler(request):
        requests.append(request)
        if "/agents/booking-agent/" in request.url.path:
            return httpx.Response(404)
        if request.method == "GET":
            return httpx.Response(200, json={"version_indicator": {"agent_version": "3"}})
        return httpx.Response(204)

    runtime.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    await runtime.cleanup()
    assert not runtime.sessions and not runtime.ready
    assert [request.method for request in requests] == ["GET", "DELETE", "GET"]
    assert all(request.url.path.endswith("/sessions/owned-billing") for request in requests[:2])
    assert "/agents/booking-agent/" in requests[-1].url.path


@pytest.fixture
async def restored_runtime(runtime, monkeypatch):
    runtime.session_id = None
    await runtime.before_snapshot()
    credential = NS(get_token=AsyncMock(return_value=NS(token="restored-token")), close=AsyncMock())
    model = NS(close=AsyncMock())
    project = NS(get_openai_client=MagicMock(return_value=model), close=AsyncMock())
    monkeypatch.setattr(shared, "DefaultAzureCredential", lambda: credential)
    monkeypatch.setattr(shared, "AIProjectClient", lambda **_: project)
    await runtime.after_restore(AgentSessionContext("restored-hub", "restore-cleanup"))
    await runtime.http.aclose()
    assert runtime.owned_sessions() == {} and runtime.ready == set()
    return runtime


def restored_ids(runtime):
    suffix = hashlib.sha256(runtime.session_id.encode()).hexdigest()[:40]
    return {role: role + "_" + suffix for role in ("billing", "booking")}


@pytest.mark.parametrize("present", [(), ("billing",), ("booking",), ("billing", "booking")])
async def test_restored_cleanup_checks_both_child_ids_and_is_idempotent(restored_runtime, present):
    runtime = restored_runtime
    ids = restored_ids(runtime)
    resources = {ids[role] for role in present} | {"other-customer"}
    requests = []
    before = (runtime.session_id, runtime.restore_id, runtime.turn, runtime.history.copy())

    def handler(request):
        requests.append(request)
        exact_id = request.url.path.rsplit("/", 1)[-1]
        assert exact_id in ids.values() and request.headers["authorization"] == "Bearer restored-token"
        if request.method == "GET":
            return (
                httpx.Response(200, json={"version_indicator": {"agent_version": "3"}})
                if exact_id in resources
                else httpx.Response(404)
            )
        assert request.method == "DELETE"
        resources.remove(exact_id)
        return httpx.Response(204)

    runtime.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    await runtime.cleanup()
    assert {r.url.path.rsplit("/", 1)[-1] for r in requests if r.method == "GET"} == set(ids.values())
    assert resources == {"other-customer"} and not runtime.sessions and not runtime.ready
    first_deletes = len([r for r in requests if r.method == "DELETE"])
    assert first_deletes == len(present)
    await runtime.cleanup()  # Repeated terminal cleanup must not create/delete anything else.
    assert len([r for r in requests if r.method == "DELETE"]) == first_deletes
    assert resources == {"other-customer"} and not runtime.sessions
    assert (runtime.session_id, runtime.restore_id, runtime.turn, runtime.history) == before


@pytest.mark.parametrize("failure", ["version", "get", "delete"])
async def test_restored_cleanup_failure_retains_binding_and_retry_finishes(restored_runtime, failure):
    runtime = restored_runtime
    ids = restored_ids(runtime)
    resources = set(ids.values())
    requests = []
    fail = True

    def handler(request):
        requests.append(request)
        sid = request.url.path.rsplit("/", 1)[-1]
        assert sid in resources | set(ids.values())
        if sid == ids["billing"] and fail:
            if failure == "get" and request.method == "GET" or failure == "delete" and request.method == "DELETE":
                return httpx.Response(500)
            if failure == "version":
                assert request.method == "GET"
                return httpx.Response(200, json={"version_indicator": {"agent_version": "99"}})
        if request.method == "GET":
            return (
                httpx.Response(200, json={"version_indicator": {"agent_version": "3"}})
                if sid in resources
                else httpx.Response(404)
            )
        assert request.method == "DELETE"
        resources.remove(sid)
        return httpx.Response(204)

    runtime.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(ExceptionGroup, match="cleanup failed"):
        await runtime.cleanup()
    assert runtime.sessions == {"billing": ids["billing"]}
    assert resources == {ids["billing"]} and not runtime.ready
    if failure in {"version", "get"}:
        assert not any(r.method == "DELETE" and r.url.path.endswith(ids["billing"]) for r in requests)
    fail = False
    await runtime.cleanup()
    assert not runtime.sessions and not runtime.ready and not resources
    assert all(r.method in {"GET", "DELETE"} for r in requests)


@pytest.mark.parametrize("role", ["billing", "booking"])
@pytest.mark.parametrize("phase", ["get", "delete_before_commit", "delete_after_commit"])
async def test_restored_cleanup_cancelled_request_retains_ownership_until_retry(restored_runtime, role, phase):
    runtime = restored_runtime
    ids = restored_ids(runtime)
    resources = set(ids.values()) | {"unrelated"}
    entered = asyncio.Event()
    block = True
    requests = []

    async def handler(request):
        requests.append(request)
        sid = request.url.path.rsplit("/", 1)[-1]
        assert sid in ids.values()
        mutation = "GET" if phase == "get" else "DELETE"
        if block and sid == ids[role] and request.method == mutation:
            if phase == "delete_after_commit":
                resources.remove(sid)  # Remote deletion committed before the local await returns.
            entered.set()
            await asyncio.Event().wait()
        if request.method == "GET":
            return (
                httpx.Response(200, json={"version_indicator": {"agent_version": "3"}})
                if sid in resources
                else httpx.Response(404)
            )
        assert request.method == "DELETE"
        resources.remove(sid)
        return httpx.Response(204)

    runtime.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    task = asyncio.create_task(runtime.cleanup())
    try:
        await asyncio.wait_for(entered.wait(), 30)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        expected_ids = ids if role == "billing" else {"booking": ids["booking"]}
        expected_resources = set(expected_ids.values()) | {"unrelated"}
        if phase == "delete_after_commit":
            expected_resources.remove(ids[role])
        assert runtime.sessions == expected_ids and resources == expected_resources and not runtime.ready
        block = False
        await runtime.cleanup()
        assert not runtime.sessions and resources == {"unrelated"}
        assert all(request.method in {"GET", "DELETE"} for request in requests)
    finally:
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)


@pytest.mark.parametrize("failure", ["get", "version", "delete_before_commit", "delete_after_commit"])
async def test_reconciling_late_child_preserves_ownership_across_cleanup_failure(runtime, failure):
    sid = runtime.domain_session_id("billing")
    resources, requests = set(), []
    fail = True

    def handler(request):
        requests.append(request)
        if request.method == "POST":
            raise httpx.ReadTimeout("CREATE response lost", request=request)
        if "/agents/booking-agent/" in request.url.path:
            return httpx.Response(404)
        if request.method == "GET":
            if fail and failure == "get":
                return httpx.Response(500)
            if sid not in resources:
                return httpx.Response(404)
            return httpx.Response(
                200, json={"version_indicator": {"agent_version": "99" if fail and failure == "version" else "3"}}
            )
        assert request.method == "DELETE"
        if not fail or failure == "delete_after_commit":
            resources.remove(sid)
        return httpx.Response(500 if fail else 204)

    runtime.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(httpx.ReadTimeout):
        await runtime.ensure_domain("billing")
    resources.add(sid)
    with pytest.raises(ExceptionGroup):
        await runtime.cleanup()
    assert runtime.sessions == {"billing": sid} and not runtime.ready
    assert runtime.unresolved_creates == ({"billing"} if failure in {"get", "version"} else set())
    assert (sid in resources) is (failure != "delete_after_commit")
    if failure in {"get", "version"}:
        assert not any(r.method == "DELETE" for r in requests)
    fail = False
    await runtime.cleanup()
    assert not runtime.sessions and not runtime.unresolved_creates and not resources
    before = len([r for r in requests if r.method == "DELETE"])
    await runtime.cleanup()
    assert len([r for r in requests if r.method == "DELETE"]) == before
    assert len([r for r in requests if r.method == "POST"]) == 1


async def test_unbound_cleanup_does_not_create_child_bindings_or_issue_requests(runtime):
    runtime.session_id = None
    await runtime.cleanup()
    assert not runtime.sessions and not runtime.ready
    runtime.credential.get_token.assert_not_awaited()


@pytest.mark.parametrize("child_version", ["3", "99"])
async def test_cli_requests_hub_identity_cleanup_before_deleting_parent(runtime, child_version):
    runtime.sessions = {"billing": "owned-billing"}
    runtime.ready = {"billing"}
    child_requests, cli_requests = [], []
    deleted = False

    def child_handler(request):
        child_requests.append(request)
        assert request.headers["authorization"] == "Bearer test-token"
        if "/agents/booking-agent/" in request.url.path:
            return httpx.Response(404)
        if request.method == "GET":
            return httpx.Response(200, json={"version_indicator": {"agent_version": child_version}})
        return httpx.Response(204)

    async def cli_handler(request):
        nonlocal deleted
        cli_requests.append(request)
        assert request.headers["authorization"] == "Bearer operator-token"
        assert "/agents/hub-agent/endpoint/" in request.url.path  # No CLI child-session requests.
        if request.method == "POST":
            assert json.loads(request.content) == {"action": "cleanup"}
            assert request.url.params["agent_session_id"] == "hub-one"
            try:
                await runtime.cleanup()
            except ExceptionGroup:
                return httpx.Response(500)
            return httpx.Response(200, json={"session_id": "hub-one", "sessions": runtime.sessions})
        if request.method == "DELETE":
            deleted = True
            return httpx.Response(204)
        return httpx.Response(404 if deleted else 200, json={"version_indicator": {"agent_version": "3"}})

    runtime.http = httpx.AsyncClient(transport=httpx.MockTransport(child_handler))
    manifest = {
        "project_endpoint": ENDPOINT,
        "agents": {role: {"name": role + "-agent", "version": "3"} for role in ("hub", "billing", "booking")},
    }
    async with httpx.AsyncClient(transport=httpx.MockTransport(cli_handler)) as client:
        if child_version == "3":
            await smoke.cleanup(client, manifest, "hub", "hub-one", {"Authorization": "Bearer operator-token"})
            assert deleted and not runtime.sessions
            assert [request.method for request in cli_requests] == ["GET", "POST", "DELETE", "GET"]
            assert [request.method for request in child_requests] == ["GET", "DELETE", "GET"]
        else:
            with pytest.raises(ExceptionGroup):
                await smoke.cleanup(client, manifest, "hub", "hub-one", {"Authorization": "Bearer operator-token"})
            assert not deleted and runtime.sessions == {"billing": "owned-billing"}
            assert [request.method for request in cli_requests] == ["GET", "POST"]
            assert [request.method for request in child_requests] == ["GET", "GET"]


@pytest.mark.parametrize("final_status,version", [("active", "3"), ("failed", "3"), ("active", "99")])
async def test_domain_polls_exact_id_and_guards_every_observed_version(runtime, monkeypatch, final_status, version):
    monkeypatch.setattr(agent, "SESSION_POLL_SECONDS", 0)  # Yield only; no live provisioning or wall-clock wait.
    requests = []

    def handler(request):
        requests.append(request)
        if request.method == "POST":
            return httpx.Response(200, json={"status": "creating", "version_indicator": {"agent_version": "3"}})
        return httpx.Response(200, json={"status": final_status, "version_indicator": {"agent_version": version}})

    runtime.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    if final_status == "active" and version == "3":
        sid = await runtime.ensure_domain("billing")
        assert "billing" in runtime.ready
    else:
        with pytest.raises(RuntimeError):
            await runtime.ensure_domain("billing")
        sid = runtime.sessions["billing"]
        assert "billing" not in runtime.ready
    assert [request.method for request in requests] == ["POST", "GET"]
    assert requests[1].url.path.endswith("/sessions/" + sid)


async def test_domain_provisioning_has_its_own_bounded_timeout_and_retains_id(runtime, monkeypatch):
    pending = asyncio.Event()
    timer = asyncio.timeout(None)
    monkeypatch.setattr(agent, "asyncio", NS(timeout=lambda _: timer, sleep=asyncio.sleep))
    monkeypatch.setattr(agent, "SESSION_POLL_SECONDS", 0)

    async def handler(request):
        if request.method == "POST":
            return httpx.Response(200, json={"status": "creating", "version_indicator": {"agent_version": "3"}})
        pending.set()
        await asyncio.Event().wait()

    runtime.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    task = asyncio.create_task(runtime.ensure_domain("billing"))
    await asyncio.wait_for(pending.wait(), 5)
    timer.reschedule(asyncio.get_running_loop().time() - 1)
    with pytest.raises(TimeoutError):
        await task
    assert "billing" in runtime.sessions and "billing" not in runtime.ready


async def test_turn_deadline_includes_waiting_for_the_session_lock(runtime, monkeypatch):
    entered = asyncio.Event()
    timer = asyncio.timeout(None)

    def timeout(_):
        entered.set()
        return timer

    monkeypatch.setattr(shared, "asyncio", NS(timeout=timeout))
    await runtime.lock.acquire()
    task = asyncio.create_task(collect(runtime))
    try:
        await asyncio.wait_for(entered.wait(), 5)
        timer.reschedule(asyncio.get_running_loop().time() - 1)
        assert (await task)[-1]["type"] == "error"
        assert not runtime.history and runtime.turn == 0
        runtime.model.responses.create.assert_not_awaited()
    finally:
        runtime.lock.release()
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)


async def test_snapshot_closes_all_clients_and_restore_rebuilds_once(runtime, monkeypatch):
    runtime.session_id = None
    old_model, old_credential, old_http = runtime.model, runtime.credential, runtime.http
    await runtime.before_snapshot()
    assert runtime.captured and runtime.model is runtime.project is runtime.credential is runtime.http is None
    old_model.close.assert_awaited_once()
    old_credential.close.assert_awaited_once()
    assert old_http.is_closed
    credential = NS(close=AsyncMock())
    model = NS(close=AsyncMock())
    project = NS(get_openai_client=MagicMock(return_value=model), close=AsyncMock())
    monkeypatch.setattr(shared, "DefaultAzureCredential", lambda: credential)
    factory = MagicMock(return_value=project)
    monkeypatch.setattr(shared, "AIProjectClient", factory)
    context = AgentSessionContext(
        "restored-session", "restore-1", {"PROJECT_ENDPOINT": "https://new.invalid/api/projects/new"}
    )
    await runtime.after_restore(context)
    await runtime.after_restore(context)
    assert runtime.session_id == "restored-session" and runtime.restore_id == "restore-1"
    assert runtime.history == []
    factory.assert_called_once_with(endpoint="https://new.invalid/api/projects/new", credential=credential)
    with pytest.raises(RuntimeError, match="another session"):
        await runtime.after_restore(AgentSessionContext("other-session", "restore-2"))


@pytest.mark.parametrize("state", ["history", "binding", "session", "busy"])
async def test_capture_rejects_customer_state(runtime, state):
    runtime.session_id = None
    if state == "history":
        runtime.history.append({"role": "user", "content": "fixture"})
    if state == "binding":
        runtime.sessions["billing"] = "owned"
    if state == "session":
        runtime.session_id = "bound"
    if state == "busy":
        await runtime.lock.acquire()
    with pytest.raises(RuntimeError):
        await runtime.before_snapshot()
    assert not runtime.captured


async def test_warmup_is_cancelled_and_drained_before_capture(runtime):
    runtime.session_id = None
    started, stopped = asyncio.Event(), asyncio.Event()

    async def warmup():
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            stopped.set()

    runtime.warmup_task = asyncio.create_task(warmup())
    await started.wait()
    await runtime.before_snapshot()
    assert stopped.is_set() and runtime.warmup_task is None and runtime.captured


def test_real_sdk_snapshot_routes_and_invoke_status(monkeypatch):
    monkeypatch.setenv("FOUNDRY_PROJECT_ENDPOINT", ENDPOINT)
    credential = NS(close=AsyncMock())
    project = NS(get_openai_client=MagicMock(return_value=NS(close=AsyncMock())), close=AsyncMock())
    monkeypatch.setattr(shared, "DefaultAzureCredential", lambda: credential)
    monkeypatch.setattr(shared, "AIProjectClient", lambda **_: project)
    server, runtime = agent.create_app(config(), configure_observability=None)
    with TestClient(server) as client:
        assert client.post("/_before_snapshot", json={}).status_code == 200
        body = {"session_context": {"session_id": "restored-one", "restore_id": "restore-one"}}
        assert client.post("/_after_restore", json=body).status_code == 200
        response = client.post("/invocations", json={"action": "status"})
        assert response.status_code == 200
        assert response.json()["captured"] and response.json()["restore_id"] == "restore-one"
        assert response.json()["history_messages"] == 0
        assert client.post("/invocations", json=[]).status_code == 400
        for action in ([], {}, None, 1, "unknown"):
            assert client.post("/invocations", json={"action": action, "input": "Hello"}).status_code == 400
    assert runtime.model is None


async def test_real_openai355_stream_parser_and_runtime_contract(runtime):
    events = [
        {
            "type": "response.output_text.delta",
            "delta": "Hello!",
            "item_id": "message-one",
            "output_index": 0,
            "content_index": 0,
            "logprobs": [],
            "sequence_number": 1,
        },
        {
            "type": "response.completed",
            "sequence_number": 2,
            "response": {
                "id": "response-one",
                "object": "response",
                "created_at": 0,
                "model": "model",
                "status": "completed",
                "output": [],
                "parallel_tool_calls": False,
                "tool_choice": "auto",
                "tools": [],
            },
        },
    ]

    def handler(request):
        assert json.loads(request.content)["store"] is False
        return httpx.Response(
            200,
            content=b"".join(protocol.sse(value) for value in events),
            headers={"content-type": "text/event-stream"},
        )

    runtime.model = AsyncOpenAI(
        api_key="offline",
        base_url="https://model.invalid/v1",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )
    assert (await collect(runtime))[-1]["type"] == "done"
    assert runtime.history[-1]["content"] == "Hello!"


async def test_consumer_closing_after_first_delta_closes_model_and_rolls_back(runtime):
    model_stream = Stream(direct("Partial"))
    runtime.model.responses.create.return_value = model_stream
    output = runtime.stream("Question")
    assert b"Partial" in await anext(output)
    await output.aclose()
    assert model_stream.closed and not runtime.history and not runtime.lock.locked()


async def test_final_tool_mismatch_never_dispatches_customer_input(runtime):
    requests = install_domain(runtime)
    events = [tool("billing")[0], *tool("booking")[1:]]
    runtime.model.responses.create.return_value = Stream(events)
    assert (await collect(runtime))[-1]["type"] == "error"
    assert not any(request.url.path.endswith("/invocations") for request in requests)


@pytest.mark.parametrize("cached", [False, True])
@pytest.mark.parametrize("final_role", ["billing", "booking"])
async def test_announced_tool_is_validated_even_when_domain_is_cached(runtime, cached, final_role):
    requests = install_domain(runtime)
    runtime.model.responses.create.return_value = Stream(tool("billing"))
    if cached:
        assert (await collect(runtime, "First question"))[-1]["type"] == "done"
    before_history = runtime.history.copy()
    requests.clear()
    model = Stream([tool("billing")[0], *tool(final_role)[1:]])
    runtime.model.responses.create.return_value = model
    result = await collect(runtime, "Follow-up")
    invokes = [request for request in requests if request.url.path.endswith("/invocations")]
    if final_role == "billing":
        assert result[-1]["type"] == "done" and len(invokes) == 1
        assert len(runtime.history) == len(before_history) + 2
    else:
        assert result[-1]["type"] == "error" and not invokes
        assert runtime.history == before_history
    assert model.closed and not runtime.lock.locked()
    # A rejected stream cannot poison the next valid routing decision.
    runtime.model.responses.create.return_value = Stream(tool("billing"))
    assert (await collect(runtime, "Valid question"))[-1]["type"] == "done"
    assert runtime.last_route == "billing"


@pytest.mark.parametrize("role", ["billing", "booking"])
@pytest.mark.parametrize("outcome", ["timeout", "cancel", "deadline"])
@pytest.mark.parametrize("reconcile", ["cleanup", "acquire"])
async def test_unresolved_child_create_survives_404_until_late_resource_is_deleted(
    runtime, monkeypatch, role, outcome, reconcile
):
    entered, release = asyncio.Event(), asyncio.Event()
    resources, requests = set(), []
    uncertain = True
    timer = asyncio.timeout(None)
    if outcome == "deadline":
        proxy = NS(**{name: getattr(asyncio, name) for name in dir(asyncio)})
        proxy.timeout = lambda _: timer
        monkeypatch.setattr(agent, "asyncio", proxy)

    async def handler(request):
        requests.append(request)
        if request.method == "POST":
            entered.set()
            await release.wait()
            raise httpx.ReadTimeout("response lost", request=request)
        sid = request.url.path.rsplit("/", 1)[-1]
        if request.method == "GET":
            return (
                httpx.Response(200, json={"status": "active", "version_indicator": {"agent_version": "3"}})
                if sid in resources
                else httpx.Response(404)
            )
        assert request.method == "DELETE" and not uncertain
        resources.remove(sid)
        return httpx.Response(204)

    runtime.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    task = asyncio.create_task(runtime.ensure_domain(role))
    try:
        await asyncio.wait_for(entered.wait(), 30)
        if outcome == "cancel":
            task.cancel()
        elif outcome == "deadline":
            timer.reschedule(asyncio.get_running_loop().time() - 1)
        else:
            release.set()
        error = {"cancel": asyncio.CancelledError, "timeout": httpx.ReadTimeout, "deadline": TimeoutError}[outcome]
        with pytest.raises(error):
            await task
        if outcome == "deadline":
            monkeypatch.setattr(agent, "asyncio", asyncio)
        sid = runtime.domain_session_id(role)
        for _ in range(2):
            with pytest.raises(ExceptionGroup, match="cleanup failed"):
                await runtime.cleanup()
            assert runtime.sessions == {role: sid} and not runtime.ready
        # Retrying acquisition must not submit another CREATE while its outcome is unknown.
        with pytest.raises(httpx.HTTPStatusError):
            await runtime.ensure_domain(role)
        assert len([r for r in requests if r.method == "POST"]) == 1
        resources.add(sid)  # Original service-side CREATE commits after both 404s.
        uncertain = False
        if reconcile == "acquire":
            assert await runtime.ensure_domain(role) == sid
            assert runtime.ready == {role}
        await runtime.cleanup()
        assert not runtime.sessions and not runtime.ready and not resources and not runtime.unresolved_creates
        await runtime.cleanup()
        assert len([r for r in requests if r.method == "DELETE"]) == 1
        assert len([r for r in requests if r.method == "POST"]) == 1
    finally:
        release.set()
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)
