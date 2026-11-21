"""Text smoke readiness, ownership checkpoints and cleanup; no Azure calls."""

import asyncio
import json
from types import SimpleNamespace as NS

import httpx
import pytest

import smoke
from common.protocol import sse
from common.records import write_report


def deployment():
    return {
        "project_endpoint": "https://sample.invalid/api/projects/test",
        "agents": {role: {"name": role + "-agent", "version": "3"} for role in ("hub", "billing", "booking")},
    }


class Credential:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def get_token(self, _):
        return NS(token="offline-token")


async def test_unavailable_hub_is_not_treated_as_successful_child_cleanup():
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(404)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ExceptionGroup, match="Cleanup incomplete"):
            await smoke.cleanup(client, deployment(), "hub", "owned", {})
    assert len(requests) == 1 and requests[0].method == "GET"


async def test_smoke_persists_planned_id_before_create_and_keeps_it_after_failure(tmp_path, monkeypatch):
    output = tmp_path / "smoke.json"
    requests = []
    deleted = False

    def handler(request):
        nonlocal deleted
        requests.append(request)
        record = json.loads(output.read_text())
        assert record["session_id"]
        if request.method == "POST":
            assert json.loads(request.content)["agent_session_id"] == record["session_id"]
            assert record["cleanup_complete"] is False
            return httpx.Response(500)
        if request.method == "DELETE":
            deleted = True
            return httpx.Response(204)
        return httpx.Response(404 if deleted else 200, json={"version_indicator": {"agent_version": "3"}})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(smoke, "httpx", NS(AsyncClient=lambda **_: real_client(transport=httpx.MockTransport(handler))))
    monkeypatch.setattr(smoke, "DefaultAzureCredential", Credential)
    with pytest.raises(httpx.HTTPStatusError):
        await smoke.run(deployment(), "billing", ["one", "two"], output)
    record = json.loads(output.read_text())
    assert record["session_id"] and record["cleanup_complete"]
    assert [request.method for request in requests] == ["POST", "GET", "DELETE", "GET"]


def test_failed_atomic_report_write_leaves_the_previous_record_intact(tmp_path):
    output = tmp_path / "report.json"
    write_report(output, {"session_id": "owned"})
    with pytest.raises(TypeError):
        write_report(output, {"invalid": object()})
    assert json.loads(output.read_text()) == {"session_id": "owned"}
    assert list(tmp_path.iterdir()) == [output]


def install_smoke_transport(monkeypatch, handler):
    real_client = httpx.AsyncClient
    monkeypatch.setattr(smoke, "httpx", NS(AsyncClient=lambda **_: real_client(transport=httpx.MockTransport(handler))))
    monkeypatch.setattr(smoke, "DefaultAzureCredential", Credential)


@pytest.mark.parametrize("initial", ["creating", "active", "idle"])
async def test_text_smoke_waits_for_the_exact_parent_before_business_input(tmp_path, monkeypatch, initial):
    calls, sid = [], None
    state = initial
    deleted = False

    def handler(request):
        nonlocal state, sid, deleted
        calls.append(request)
        if request.method == "POST":
            body = json.loads(request.content)
            if request.url.path.endswith("/sessions"):
                sid = body["agent_session_id"]
                return httpx.Response(200, json={"status": state, "version_indicator": {"agent_version": "3"}})
            assert request.url.params["agent_session_id"] == sid
            if body.get("action") == "status":
                return httpx.Response(200, json={"captured": True, "restore_id": "restore-one"})
            assert state in {"active", "idle"}, "Business input must not race creating session compute"
            return httpx.Response(
                200,
                content=sse({"type": "output_audio_transcription.delta", "delta": "answer"}) + sse({"type": "done"}),
            )
        assert request.url.path.endswith("/sessions/" + sid)
        if request.method == "DELETE":
            deleted = True
            return httpx.Response(204)
        if deleted:
            return httpx.Response(404)
        state = "active"
        return httpx.Response(200, json={"status": state, "version_indicator": {"agent_version": "3"}})

    install_smoke_transport(monkeypatch, handler)
    monkeypatch.setattr(smoke, "SESSION_POLL_SECONDS", 0, raising=False)
    output = tmp_path / "smoke.json"
    await smoke.run(deployment(), "billing", ["one", "two"], output)
    assert json.loads(output.read_text())["cleanup_complete"] and deleted
    creates = [request for request in calls if request.method == "POST" and request.url.path.endswith("/sessions")]
    assert len(creates) == 1
    if initial == "creating":
        assert calls[1].method == "GET" and calls[1].url.path.endswith("/sessions/" + sid)


@pytest.mark.parametrize("failure", ["failed", "version", "poll_http"])
async def test_parent_readiness_failure_preserves_primary_and_never_sends_business(tmp_path, monkeypatch, failure):
    requests = []
    sid = None
    deleted = False
    poll_failed = False
    version = "99" if failure == "version" else "3"

    def handler(request):
        nonlocal sid, deleted, poll_failed
        requests.append(request)
        if request.method == "POST":
            assert request.url.path.endswith("/sessions"), "Unready parent cannot receive invocations"
            sid = json.loads(request.content)["agent_session_id"]
            return httpx.Response(200, json={"status": "creating", "version_indicator": {"agent_version": version}})
        assert request.url.path.endswith("/sessions/" + sid)
        if request.method == "DELETE":
            assert version == "3"
            deleted = True
            return httpx.Response(204)
        if deleted:
            return httpx.Response(404)
        if failure == "poll_http" and not poll_failed:
            poll_failed = True
            return httpx.Response(500)
        return httpx.Response(200, json={"status": "failed", "version_indicator": {"agent_version": version}})

    install_smoke_transport(monkeypatch, handler)
    monkeypatch.setattr(smoke, "SESSION_POLL_SECONDS", 0)
    output = tmp_path / "failed-smoke.json"
    error = httpx.HTTPStatusError if failure == "poll_http" else RuntimeError
    with pytest.raises(error) as caught:
        await smoke.run(deployment(), "billing", ["one", "two"], output)
    report = json.loads(output.read_text())
    assert report["session_id"] == sid and report["error_type"] == error.__name__ and not report["turns"]
    assert len([r for r in requests if r.method == "POST"]) == 1
    if failure == "version":
        assert "pinned version" in str(caught.value)
        assert not deleted and not report["cleanup_complete"] and report["cleanup_error_type"] == "ExceptionGroup"
    else:
        assert deleted and report["cleanup_complete"]
        if failure == "failed":
            assert "provisioning failed" in str(caught.value)


@pytest.mark.parametrize("outcome", ["timeout", "cancel"])
async def test_parent_readiness_deadline_or_cancel_retains_exact_id_and_allows_cleanup(tmp_path, monkeypatch, outcome):
    entered = asyncio.Event()
    timer = asyncio.timeout(None)
    requests, sid = [], None
    block = True
    deleted = False

    async def handler(request):
        nonlocal sid, deleted
        requests.append(request)
        if request.method == "POST":
            assert request.url.path.endswith("/sessions")
            sid = json.loads(request.content)["agent_session_id"]
            return httpx.Response(200, json={"status": "creating", "version_indicator": {"agent_version": "3"}})
        assert request.url.path.endswith("/sessions/" + sid)
        if block:
            entered.set()
            await asyncio.Event().wait()
        if request.method == "DELETE":
            deleted = True
            return httpx.Response(204)
        return (
            httpx.Response(404)
            if deleted
            else httpx.Response(200, json={"status": "active", "version_indicator": {"agent_version": "3"}})
        )

    install_smoke_transport(monkeypatch, handler)
    proxy = NS(**{name: getattr(asyncio, name) for name in dir(asyncio)})
    proxy.timeout = lambda _: timer
    monkeypatch.setattr(smoke, "asyncio", proxy)
    monkeypatch.setattr(smoke, "SESSION_POLL_SECONDS", 0)
    output = tmp_path / "failed-smoke.json"
    task = asyncio.create_task(smoke.run(deployment(), "billing", ["one", "two"], output))
    try:
        await asyncio.wait_for(entered.wait(), 30)
        block = False  # Subsequent cleanup GETs can observe the same accepted parent.
        if outcome == "timeout":
            timer.reschedule(asyncio.get_running_loop().time() - 1)
        else:
            task.cancel()
        error = TimeoutError if outcome == "timeout" else asyncio.CancelledError
        with pytest.raises(error):
            await task
        report = json.loads(output.read_text())
        assert report["session_id"] == sid and report["error_type"] == error.__name__
        assert report["cleanup_complete"] and not report["turns"] and deleted
        assert len([r for r in requests if r.method == "POST"]) == 1
        # Repeating cleanup with the preserved ID does not create/invoke anything.
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await smoke.cleanup(client, deployment(), "billing", sid, {}, ownership=report)
        assert len([r for r in requests if r.method == "POST"]) == 1
    finally:
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)


@pytest.mark.parametrize("known", [False, True])
async def test_absent_domain_requires_recorded_create_outcome_for_cleanup(known):
    report = {"role": "billing", "session_id": "owned", "create_unresolved": not known}
    calls = []

    def handler(request):
        calls.append(request.method)
        return httpx.Response(404)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        if known:
            await smoke.cleanup(client, deployment(), "billing", "owned", {}, ownership=report)
            await smoke.cleanup(client, deployment(), "billing", "owned", {}, ownership=report)
        else:
            for record in (None, report):
                with pytest.raises(ExceptionGroup, match="Cleanup incomplete"):
                    await smoke.cleanup(client, deployment(), "billing", "owned", {}, ownership=record)
            assert report["create_unresolved"]
    assert calls == ["GET", "GET"]


async def test_failed_parent_readiness_is_not_hidden_by_final_checkpoint_failure(tmp_path, monkeypatch):
    output = tmp_path / "smoke.json"
    deleted = False

    def handler(request):
        nonlocal deleted
        if request.method == "DELETE":
            deleted = True
            return httpx.Response(204)
        if deleted:
            return httpx.Response(404)
        return httpx.Response(200, json={"status": "failed", "version_indicator": {"agent_version": "3"}})

    install_smoke_transport(monkeypatch, handler)
    save = smoke.write_report
    count = 0

    def write_report(path, report):
        nonlocal count
        count += 1
        if count == 2:
            raise OSError("controlled checkpoint failure")
        save(path, report)

    monkeypatch.setattr(smoke, "write_report", write_report)
    with pytest.raises(RuntimeError, match="provisioning failed") as caught:
        await smoke.run(deployment(), "billing", ["one", "two"], output)
    assert deleted and json.loads(output.read_text())["session_id"]
    assert any("checkpoint failed: OSError" in note for note in caught.value.__notes__)


@pytest.mark.parametrize("role", ["billing", "booking", "hub"])
@pytest.mark.parametrize("outcome", ["timeout", "cancel"])
async def test_unresolved_parent_create_keeps_report_until_late_resource_cleanup(tmp_path, monkeypatch, role, outcome):
    output = tmp_path / "late-parent.json"
    entered = asyncio.Event()
    resources, requests = set(), []
    sid = None

    async def handler(request):
        nonlocal sid
        requests.append(request)
        if request.method == "POST" and request.url.path.endswith("/sessions"):
            sid = json.loads(request.content)["agent_session_id"]
            assert json.loads(output.read_text())["session_id"] == sid
            entered.set()
            if outcome == "timeout":
                raise httpx.ReadTimeout("CREATE response lost", request=request)
            await asyncio.Event().wait()
        assert request.url.params.get("agent_session_id", sid) == sid
        if request.method == "GET":
            return (
                httpx.Response(200, json={"version_indicator": {"agent_version": "3"}})
                if sid in resources
                else httpx.Response(404)
            )
        if request.method == "DELETE":
            resources.remove(sid)
            return httpx.Response(204)
        assert json.loads(request.content) == {"action": "cleanup"}
        return httpx.Response(200, json={"session_id": sid, "sessions": {}})

    install_smoke_transport(monkeypatch, handler)
    task = asyncio.create_task(smoke.run(deployment(), role, ["one", "two"], output))
    try:
        await asyncio.wait_for(entered.wait(), 30)
        if outcome == "cancel":
            task.cancel()
        error = asyncio.CancelledError if outcome == "cancel" else httpx.ReadTimeout
        with pytest.raises(error):
            await task
        report = json.loads(output.read_text())
        assert report["session_id"] == sid and report["error_type"] == error.__name__
        assert not report["cleanup_complete"] and not report["turns"]
        assert report["create_unresolved"]
        # Use the durable outcome, not a fresh default, when retrying operator cleanup.
        async with smoke.httpx.AsyncClient() as client:
            with pytest.raises(ExceptionGroup, match="Cleanup incomplete"):
                await smoke.cleanup(client, deployment(), role, sid, {}, ownership=report)
            assert report["create_unresolved"]
            resources.add(sid)
            await smoke.cleanup(client, deployment(), role, sid, {}, ownership=report)
            assert not report["create_unresolved"] and not resources
            if role != "hub":
                await smoke.cleanup(client, deployment(), role, sid, {}, ownership=report)
        assert len([r for r in requests if r.method == "DELETE"]) == 1
        assert len([r for r in requests if r.url.path.endswith("/sessions")]) == 1
        assert all("input" not in json.loads(r.content) for r in requests if r.method == "POST")
    finally:
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)


@pytest.mark.parametrize("wrong", ["session_id", "role"])
async def test_cleanup_rejects_another_ownership_record_without_network(wrong):
    report = {"role": "billing", "session_id": "owned", "create_unresolved": False}
    report[wrong] = "other"
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(404)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ValueError, match="exact role and session"):
            await smoke.cleanup(client, deployment(), "billing", "owned", {}, ownership=report)
        assert not calls
        report[wrong] = "billing" if wrong == "role" else "owned"
        await smoke.cleanup(client, deployment(), "billing", "owned", {}, ownership=report)
        assert len(calls) == 1


@pytest.mark.parametrize("role", ["billing", "booking"])
@pytest.mark.parametrize("failure", ["get", "version", "delete_before_commit", "delete_after_commit"])
async def test_parent_reconciliation_failure_retains_report_and_retry_is_scoped(role, failure):
    report = {"role": role, "session_id": "owned", "create_unresolved": True}
    resources, calls = {"owned", "other"}, []
    fail = True

    def handler(request):
        calls.append(request)
        assert request.url.path.endswith("/sessions/owned")
        if request.method == "GET":
            if fail and failure == "get":
                return httpx.Response(500)
            if "owned" not in resources:
                return httpx.Response(404)
            version = "99" if fail and failure == "version" else "3"
            return httpx.Response(200, json={"version_indicator": {"agent_version": version}})
        assert request.method == "DELETE"
        if not fail or failure == "delete_after_commit":
            resources.remove("owned")
        return httpx.Response(500 if fail else 204)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ExceptionGroup):
            await smoke.cleanup(client, deployment(), role, "owned", {}, ownership=report)
        assert report["create_unresolved"] is (failure in {"get", "version"})
        if failure in {"get", "version"}:
            assert not any(r.method == "DELETE" for r in calls)
        assert ("owned" in resources) is (failure != "delete_after_commit")
        fail = False
        await smoke.cleanup(client, deployment(), role, "owned", {}, ownership=report)
        assert resources == {"other"} and not report["create_unresolved"]
        before = len([r for r in calls if r.method == "DELETE"])
        await smoke.cleanup(client, deployment(), role, "owned", {}, ownership=report)
        assert len([r for r in calls if r.method == "DELETE"]) == before


@pytest.mark.parametrize("status", [400, 401, 403, 404, 429, 408, 500, 503])
async def test_parent_create_rejection_is_distinct_from_an_ambiguous_failure(tmp_path, monkeypatch, status):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(status if request.method == "POST" else 404)

    install_smoke_transport(monkeypatch, handler)
    output = tmp_path / "rejected-parent.json"
    with pytest.raises(httpx.HTTPStatusError) as caught:
        await smoke.run(deployment(), "billing", ["one", "two"], output)
    assert caught.value.response.status_code == status
    report = json.loads(output.read_text())
    rejected = status in {400, 401, 403, 404, 429}
    assert report["create_unresolved"] is not rejected
    assert report["cleanup_complete"] is rejected and not report["turns"]
    async with smoke.httpx.AsyncClient() as client:
        if rejected:
            await smoke.cleanup(client, deployment(), "billing", report["session_id"], {}, ownership=report)
        else:
            with pytest.raises(ExceptionGroup):
                await smoke.cleanup(client, deployment(), "billing", report["session_id"], {}, ownership=report)
    assert [r.method for r in calls] == ["POST", "GET", "GET"]
