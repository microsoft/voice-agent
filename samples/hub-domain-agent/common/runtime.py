"""Shared snapshot, client, streaming and SDK lifecycle plumbing only."""

from __future__ import annotations

import asyncio
import logging
import uuid
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from contextlib import aclosing
from dataclasses import replace
from time import perf_counter
from typing import Any

import httpx
from azure.ai.agentserver.core import AgentSessionContext
from azure.ai.agentserver.invocations import InvocationAgentServerHost
from azure.ai.projects.aio import AIProjectClient
from azure.identity.aio import DefaultAzureCredential
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse

from common.config import Config, project_endpoint
from common.protocol import sse

logger = logging.getLogger(__name__)
TURN_TIMEOUT_SECONDS = 90
HISTORY_MESSAGES = 12


class Runtime(ABC):
    """One exclusive Hosted session; subclasses own business behavior."""

    def __init__(self, config: Config, *, role: str, prompt: str, warmup: bool = False) -> None:
        self.config = config
        self.role, self.prompt, self.model_warmup = role, prompt, warmup
        self.boot_id = uuid.uuid4().hex
        self.restore_id: str | None = None
        self.session_id: str | None = None
        self.captured = False
        self.history: list[dict[str, str]] = []
        self.turn = 0
        self.last_route: str | None = None
        self.lock = asyncio.Lock()
        self.credential: Any = None
        self.project: Any = None
        self.model: Any = None
        self.http: httpx.AsyncClient | None = None
        self.warmup_task: asyncio.Task | None = None

    def clients(self) -> None:
        if self.credential is None:
            self.credential = DefaultAzureCredential()
        if self.project is None:
            self.project = AIProjectClient(endpoint=self.config.endpoint, credential=self.credential)
        if self.model is None:
            self.model = self.project.get_openai_client(max_retries=0, timeout=TURN_TIMEOUT_SECONDS)
        if self.http is None:
            self.http = httpx.AsyncClient(timeout=TURN_TIMEOUT_SECONDS)

    async def close_clients(self) -> None:
        for field in ("http", "model", "project", "credential"):
            client = getattr(self, field)
            if client is not None:
                closer = client.aclose if field == "http" else client.close
                await closer()
                setattr(self, field, None)

    async def warmup(self) -> None:
        try:
            self.clients()
            async with asyncio.timeout(15):
                await self.model.responses.create(
                    model=self.config.model, instructions=self.prompt, input="Hello", store=False
                )
            logger.info("MODEL_WARMUP role=%s completed=true", self.role)
        except Exception as error:
            logger.warning("MODEL_WARMUP role=%s completed=false error_type=%s", self.role, type(error).__name__)

    def start_warmup(self) -> None:
        if self.model_warmup:
            self.warmup_task = asyncio.create_task(self.warmup(), name="domain-model-warmup")

    async def quiesce(self) -> None:
        if self.warmup_task is not None:
            self.warmup_task.cancel()
            async with asyncio.timeout(20):
                await asyncio.gather(self.warmup_task, return_exceptions=True)
            self.warmup_task = None

    async def before_snapshot(self) -> None:
        if self.lock.locked() or self.history or self.owned_sessions() or self.session_id is not None:
            raise RuntimeError("Refusing reusable snapshot containing customer activity or bindings")
        await self.quiesce()
        await self.close_clients()
        self.captured = True
        logger.info("SNAPSHOT_BEFORE role=%s boot_id=%s clients_closed=true", self.role, self.boot_id)

    async def after_restore(self, context: AgentSessionContext) -> None:
        if not self.captured:
            raise RuntimeError("Restore requires a successful capture hook")
        if self.session_id is not None and self.session_id != context.session_id:
            raise RuntimeError("Cannot bind this process to another session")
        if self.restore_id == context.restore_id:
            return
        await self.quiesce()
        await self.close_clients()
        overrides = context.session_env_overrides
        self.config = replace(
            self.config,
            endpoint=project_endpoint(overrides.get("PROJECT_ENDPOINT", self.config.endpoint)),
            model=overrides.get("MODEL_DEPLOYMENT", self.config.model),
        )
        try:
            self.clients()  # Fresh credentials, model/HTTP clients; never reuse captured sockets.
        except BaseException:
            await self.close_clients()
            raise
        self.session_id, self.restore_id = context.session_id, context.restore_id
        self.start_warmup()
        logger.info(
            "SNAPSHOT_AFTER role=%s boot_id=%s restore_id=%s session_id=%s clients_rebuilt=true",
            self.role,
            self.boot_id,
            self.restore_id,
            self.session_id,
        )

    def owned_sessions(self) -> dict[str, str]:
        """Only the Hub overrides this with its child-session ownership map."""
        return {}

    async def cleanup(self) -> None:
        """Default for runtimes without child sessions; Hub overrides it."""

    async def model_events(self, text: str, **options: Any) -> AsyncIterator[Any]:
        self.clients()
        stream = await self.model.responses.create(
            model=self.config.model,
            instructions=self.prompt,
            input=[*self.history, {"role": "user", "content": text}],
            stream=True,
            store=False,
            **options,
        )
        async with stream:
            async for event in stream:
                yield event

    async def text_answer(self, text: str) -> AsyncIterator[str]:
        """Generic text-model stream: no tools, routing, or specialist facts."""
        completed = False
        async with aclosing(self.model_events(text)) as events:
            async for event in events:
                if event.type == "response.output_text.delta":
                    yield event.delta
                elif event.type == "response.completed":
                    completed = True
                elif event.type in {"response.failed", "response.incomplete", "error"}:
                    raise RuntimeError("Model stream failed or incomplete")
                elif event.type in {"response.output_item.added", "response.output_item.done"}:
                    if event.item.type == "function_call":
                        raise RuntimeError("Text responder cannot request tools")
        if not completed:
            raise RuntimeError("Truncated model stream")

    @abstractmethod
    def answer(self, text: str) -> AsyncIterator[str]:
        """Implemented separately by Hub, Billing, and Booking."""
        raise NotImplementedError

    async def stream(self, text: str) -> AsyncIterator[bytes]:
        try:
            async with asyncio.timeout(TURN_TIMEOUT_SECONDS), self.lock:
                self.turn += 1
                started = perf_counter()
                reply = ""
                async with aclosing(self.answer(text)) as deltas:
                    async for delta in deltas:
                        if not reply and delta:
                            logger.info(
                                "FIRST_TEXT session_id=%s turn=%s elapsed_ms=%.2f",
                                self.session_id,
                                self.turn,
                                (perf_counter() - started) * 1000,
                            )
                        reply += delta
                        yield sse({"type": "output_audio_transcription.delta", "delta": delta})
                if not reply:
                    raise RuntimeError("Empty model/Domain answer")
                self.history.extend([{"role": "user", "content": text}, {"role": "assistant", "content": reply}])
                del self.history[:-HISTORY_MESSAGES]
                yield sse({"type": "output_audio_transcription.done", "text": reply})
                yield sse({"type": "done"})
        except Exception as error:
            logger.error(
                "TURN_FAILED role=%s session_id=%s error_type=%s",
                self.role,
                self.session_id,
                type(error).__name__,
            )
            yield sse({"type": "error", "error": {"message": "Agent request failed; inspect server diagnostics"}})

    async def invoke(self, request: Request) -> Response:
        try:
            body = await request.json()
        except ValueError:
            return JSONResponse({"error": "Expected a JSON object"}, status_code=400)
        if not isinstance(body, dict):
            return JSONResponse({"error": "Expected a JSON object"}, status_code=400)
        sid = request.state.session_id
        if self.session_id is not None and self.session_id != sid:
            return JSONResponse({"error": "Process already bound to another session"}, status_code=409)
        self.session_id = sid
        action = body.get("action")
        if "action" in body and (not isinstance(action, str) or action not in {"status", "cleanup"}):
            return JSONResponse({"error": "Expected action status or cleanup"}, status_code=400)
        if action in {"status", "cleanup"}:
            async with asyncio.timeout(TURN_TIMEOUT_SECONDS), self.lock:
                if body["action"] == "cleanup":
                    await self.cleanup()
                return JSONResponse(
                    {
                        "role": self.role,
                        "session_id": self.session_id,
                        "boot_id": self.boot_id,
                        "restore_id": self.restore_id,
                        "captured": self.captured,
                        "sessions": self.owned_sessions(),
                        "history_messages": len(self.history),
                        "turn": self.turn,
                        "last_route": self.last_route,
                    }
                )
        text = body.get("input") or body.get("message")
        if not isinstance(text, str) or not text.strip():
            return JSONResponse({"error": "Expected nonempty input"}, status_code=400)
        logger.info(
            "INVOKE role=%s session_id=%s restore_id=%s captured=%s history_messages=%s",
            self.role,
            self.session_id,
            self.restore_id,
            self.captured,
            len(self.history),
        )
        return StreamingResponse(
            self.stream(text),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "x-sample-restore-id": self.restore_id or "none",
                "x-sample-history-messages": str(len(self.history)),
            },
        )

    async def shutdown(self) -> None:
        await self.quiesce()
        try:
            async with asyncio.timeout(20):
                await self.cleanup()
        finally:
            await self.close_clients()


def create_app(runtime: Runtime, **kwargs: Any) -> tuple[InvocationAgentServerHost, Runtime]:
    server = InvocationAgentServerHost(**kwargs)
    server.invoke_handler(runtime.invoke)
    server.before_snapshot_handler(runtime.before_snapshot)
    server.after_restore_handler(runtime.after_restore)
    server.shutdown_handler(runtime.shutdown)
    return server, runtime


async def serve(runtime: Runtime) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    logging.getLogger("azure").setLevel(logging.WARNING)
    server, runtime = create_app(runtime)
    runtime.start_warmup()
    try:
        await server.run_async()
    finally:
        await runtime.shutdown()
