"""Web cockpit; Azure credentials and vehicle tools stay server-side."""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import logging
import os
import uuid
from contextlib import AsyncExitStack
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from aiohttp import WSMsgType, web

from hosting import PublicDemoLimits, public_origin
from vehicle import Dispatcher, ToolRejected, configure_console
from browser_control import BrowserControl, CockpitDispatcher
from tool_contracts import definitions
from webiq_client import WebIQ
from vehicle_voice_agent import Session, definition, project_endpoint, receive

ROOT = Path(__file__).parent
logger = logging.getLogger(__name__)


@dataclass
class Settings:
    demo: bool
    port: int
    dispatcher: Dispatcher = field(default_factory=Dispatcher)
    voice_active: bool = False
    client: Any = None
    agent_name: str | None = None
    agent_enabled: bool = False
    public_origin: str | None = None
    limits: PublicDemoLimits | None = None
    voice_session_seconds: float = 300
    browsers: dict[str, BrowserControl] = field(default_factory=dict)
    grounding: Any = None


SETTINGS = web.AppKey("settings", Settings)


def snapshot(dispatcher: Dispatcher, browser: BrowserControl | None = None) -> dict[str, Any]:
    vehicle = dispatcher.vehicle
    domains = vehicle.domains()
    if browser and not browser.closed and not browser.socket.closed:
        for domain, value in browser.states.items():
            domains[domain].update(value)
    return {**vehicle.execute("get_vehicle_status", {})["state"],
            "rev": vehicle.revision, "domains": domains}


@web.middleware
async def local_only(request: web.Request, handler):
    settings = request.app[SETTINGS]
    port = settings.port
    expected_origin = settings.public_origin or f"{request.scheme}://{request.host}"
    allowed_hosts = (
        {settings.public_origin.removeprefix("https://")} if settings.public_origin
        else {f"127.0.0.1:{port}", f"localhost:{port}"}
    )
    if request.host not in allowed_hosts:
        raise web.HTTPForbidden(text="Use the configured cockpit address.")
    origin = request.headers.get("Origin")
    if origin and origin != expected_origin:
        raise web.HTTPForbidden(text="Cross-origin requests are not allowed.")
    if (request.method != "GET" or request.path in {"/ws", "/control"}) and not origin:
        raise web.HTTPForbidden(text="Browser actions require a same-origin request.")
    response = await handler(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


async def index(_request):
    return web.FileResponse(ROOT / "static" / "index.html")


async def health(_request):
    return web.json_response({"status": "ok"})

def grounding_state(settings: Settings, browser: BrowserControl) -> dict[str, Any]:
    return {"available": settings.grounding.available,
            "requested": browser.webiq_enabled,
            "enabled": settings.grounding.available and browser.webiq_enabled,
            "health": settings.grounding.health}


async def asset(request):
    name = request.match_info["name"]
    if name not in {
        "app.js", "style.css", "agent-theme.css", "pcm-worklet.js", "playback.js", "car.svg",
        "car-view.js", "car-model.mjs", "complete.stl", "three.module.js",
        "three.core.js", "OrbitControls.js", "vehicle-doors.glb",
        "vendor/loaders/GLTFLoader.js", "vendor/utils/BufferGeometryUtils.js",
        "vendor/environments/RoomEnvironment.js",
        "drive-cycle.mjs", "road-scene.mjs", "ftp75.txt", "i18n.mjs",
        "autopilot-sim.mjs", "media-player.mjs", "phone-demo.mjs", "cockpit.js", "cockpit.css",
    }:
        raise web.HTTPNotFound()
    return web.FileResponse(ROOT / "static" / name)


async def state(request):
    settings = request.app[SETTINGS]
    return web.json_response({
        "mode": "offline" if settings.demo else "cloud",
        "state": snapshot(settings.dispatcher), "execution_scope": "local_cockpit",
        "public_demo": bool(settings.public_origin),
        "voice_session_seconds": settings.voice_session_seconds if settings.public_origin else None,
        "voice_starts_per_day": settings.limits.voice_starts if settings.limits else None,
        "contracts": definitions(),
        "grounding": {"enabled": settings.grounding.available, "health": settings.grounding.health},
    })


async def manual_tool(request):
    settings = request.app[SETTINGS]
    if settings.limits and not settings.limits.admit("manual"):
        return web.json_response({"ok": False, "error": "Public demo control limit reached. Try again in one minute."}, status=429)
    try:
        body = await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise web.HTTPBadRequest(text="Expected a JSON tool request.")
    if not isinstance(body, dict) or set(body) != {"name", "arguments"}:
        raise web.HTTPBadRequest(text="Expected name and arguments.")
    if not isinstance(body["name"], str):
        raise web.HTTPBadRequest(text="Tool name must be a string.")
    dispatcher = Dispatcher(vehicle=settings.dispatcher.vehicle) if settings.public_origin else settings.dispatcher
    if len(dispatcher.completed) >= 1000:
        return web.json_response({"ok": False, "error": "Tool limit reached. Restart the cockpit server."}, status=429)
    result = dispatcher.dispatch({
        "call_id": uuid.uuid4().hex, "name": body["name"],
        "arguments": json.dumps(body["arguments"]),
    })
    return web.json_response({**result, "state": snapshot(settings.dispatcher)},
                             status=200 if result["ok"] else 400)


async def control(request):
    settings = request.app[SETTINGS]
    if len(settings.browsers) >= 32:
        raise web.HTTPServiceUnavailable(text="Cockpit control capacity reached.")
    socket = web.WebSocketResponse(max_msg_size=8192, heartbeat=5, receive_timeout=20)
    await socket.prepare(request)
    browser = BrowserControl(socket)
    dispatcher = CockpitDispatcher(settings.dispatcher.vehicle, browser)
    settings.browsers[browser.epoch] = browser
    tasks: set[asyncio.Task] = set()

    async def command(packet):
        identity = packet.get("id")
        if not isinstance(identity, str) or not 1 <= len(identity) <= 128:
            raise ValueError("Invalid manual request identity.")
        if packet.get("name") == "ground_public_answer":
            raise ValueError("Manual car controls cannot perform public lookups.")
        if settings.limits and not settings.limits.admit("manual"):
            result = {"ok": False, "error": "RATE_LIMIT: Public control limit reached."}
        elif type(packet.get("revision")) is not int:
            result = {"ok": False, "error": "INVALID_ARGUMENT: A state revision is required."}
        else:
            result = await dispatcher.dispatch_async({
                "call_id": identity, "name": packet.get("name"),
                "arguments": json.dumps(packet.get("arguments"), allow_nan=False),
            }, expected_revision=packet["revision"])
        await socket.send_json({"type": "command_result", "id": identity, "result": result,
                                "state": snapshot(settings.dispatcher, browser)})
        await broadcast_state(settings)

    try:
        await socket.send_json({"type": "control_ready", "epoch": browser.epoch,
                                "state": snapshot(settings.dispatcher, browser),
                                "grounding": grounding_state(settings, browser)})
        async for message in socket:
            if message.type == WSMsgType.TEXT:
                packet = json.loads(message.data)
                if not isinstance(packet, dict):
                    raise ValueError("Invalid control packet.")
                kind = packet.get("type")
                if kind == "browser_receipt":
                    browser.receipt(packet)
                elif kind == "webiq_preference":
                    if (set(packet) != {"type", "id", "epoch", "enabled"}
                            or packet["epoch"] != browser.epoch or type(packet["enabled"]) is not bool
                            or not isinstance(packet["id"], str) or not 1 <= len(packet["id"]) <= 128):
                        raise ValueError("Invalid Web IQ client preference.")
                    if browser.webiq_enabled != packet["enabled"]:
                        browser.webiq_revision += 1
                    browser.webiq_enabled = packet["enabled"]
                    await socket.send_json({"type": "webiq_state", "id": packet["id"],
                                            "grounding": grounding_state(settings, browser)})
                elif kind == "browser_state" and packet.get("epoch") == browser.epoch:
                    browser.accept_state(packet.get("domain"), packet.get("state"))
                elif kind == "command":
                    if len(tasks) >= 8:
                        raise ValueError("Too many pending manual controls.")
                    task = asyncio.create_task(command(packet))
                    tasks.add(task)
                    # Receipts must be read while command tasks await browser execution.
                elif kind == "ping":
                    await socket.send_json({"type": "control_pong"})
                else:
                    raise ValueError("Unknown control packet.")
                for task in list(tasks):
                    if task.done():
                        tasks.remove(task)
                        task.result()
            elif message.type == WSMsgType.ERROR:
                raise ConnectionResetError("Control socket failed.")
    except (ValueError, ToolRejected, RuntimeError, ConnectionResetError):
        logger.warning("Browser control protocol failed; closing its owner channel.")
        if not socket.closed:
            await socket.send_json({"type": "control_error", "message": "Control channel failed. Reconnect the cockpit."})
    finally:
        browser.close()
        settings.browsers.pop(browser.epoch, None)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await socket.close()
    return socket


async def broadcast_state(settings):
    for browser in list(settings.browsers.values()):
        if not browser.closed and not browser.socket.closed:
            try:
                await browser.socket.send_json({
                    "type": "snapshot", "state": snapshot(settings.dispatcher, browser),
                })
            except ConnectionResetError:
                browser.close()


class BrowserAudio:
    requires_ack = True

    def __init__(self) -> None:
        self.queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=256)
        self.generation = 0

    def output(self, delta: Any, event: dict[str, Any]) -> None:
        pcm = delta if isinstance(delta, bytes) else base64.b64decode(delta, validate=True)
        if len(pcm) % 2:
            raise RuntimeError("Incomplete output PCM frames.")
        if not isinstance(event.get("item_id"), str) or not isinstance(event.get("response_id"), str):
            raise RuntimeError("Output audio must identify its response and conversation item.")
        try:
            self.queue.put_nowait({
                "type": "audio", "generation": self.generation,
                "item_id": event["item_id"], "content_index": event.get("content_index", 0),
                "response_id": event["response_id"], "pcm": base64.b64encode(pcm).decode("ascii"),
            })
        except asyncio.QueueFull as error:
            raise RuntimeError("Browser audio transport cannot keep up.") from error

    async def send(self, socket):
        while True:
            event = await self.queue.get()
            if event["generation"] == self.generation:
                await socket.send_json(event)

    def interrupt(self) -> int:
        self.generation += 1
        while not self.queue.empty():
            self.queue.get_nowait()
        return self.generation


async def cloud_resources(app):
    from azure.ai.projects.aio import AIProjectClient
    from azure.identity.aio import AzureCliCredential, DefaultAzureCredential, ManagedIdentityCredential

    settings = app[SETTINGS]
    if settings.demo:
        yield
        return
    endpoint = project_endpoint(os.getenv("AZURE_VOICE_AGENTS_ENDPOINT", ""))
    mode = os.getenv("AZURE_CREDENTIAL_MODE", "cli")
    if mode == "cli":
        credential = AzureCliCredential()
    elif mode == "default":
        credential = DefaultAzureCredential()
    elif mode == "managed_identity":
        credential = ManagedIdentityCredential(client_id=os.getenv("AZURE_CLIENT_ID"))
    else:
        raise ValueError("AZURE_CREDENTIAL_MODE must be cli, default, or managed_identity.")
    async with credential, AIProjectClient(
        endpoint=endpoint, credential=credential, allow_preview=True,
    ) as client:
        settings.client = client
        try:
            yield
        finally:
            settings.client = None


async def ensure_agent(settings: Settings, socket) -> str:
    from azure.ai.projects.models import VoiceAgentDefinition

    started = asyncio.get_running_loop().time()
    if settings.agent_name is None:
        await socket.send_json({"type": "progress", "message": "Signing in to Azure and creating the cockpit agent (first connection only)…"})
        name = f"vehicle-cockpit-{uuid.uuid4().hex[:12]}"
        async with asyncio.timeout(60):
            await settings.client.agents.create_version(
                agent_name=name,
                definition=VoiceAgentDefinition(definition(
                    os.getenv("AZURE_VOICE_AGENTS_MODEL", "gpt-realtime"),
                    os.getenv("AZURE_VOICE_AGENTS_VOICE", "en-US-AvaNeural"), False,
                )),
            )
        settings.agent_name = name
        logger.info("Agent creation took %.1fs: %s", asyncio.get_running_loop().time() - started, name)
    if not settings.agent_enabled:
        await socket.send_json({"type": "progress", "message": "Enabling the cockpit agent…"})
        async with asyncio.timeout(30):
            await settings.client.agents.enable(settings.agent_name)
        settings.agent_enabled = True
    logger.info("Agent ready after %.1fs: %s", asyncio.get_running_loop().time() - started, settings.agent_name)
    return settings.agent_name


async def cloud_session(request, socket, incoming):
    settings = request.app[SETTINGS]
    owner = settings.browsers.get(request.query.get("owner", ""))
    if not owner or owner.closed or owner.socket.closed:
        await socket.send_json({"type": "error", "message": "Reconnect cockpit controls, then connect voice to this browser."})
        return
    name = await ensure_agent(settings, socket)
    await socket.send_json({"type": "agent", "name": name})
    await socket.send_json({"type": "progress", "message": "Opening the realtime voice connection…"})
    started = asyncio.get_running_loop().time()
    async with AsyncExitStack() as stack:
        async with asyncio.timeout(45):
            connection = await stack.enter_async_context(
                settings.client.beta.voice_agents.realtime.connect(agent_name=name),
            )
            while True:
                event = await receive(connection)
                if event.get("type") == "session.updated":
                    config = event.get("session") or {}
                    vad = ((config.get("audio") or {}).get("input") or {}).get(
                        "turn_detection", config.get("turn_detection"),
                    )
                    if not isinstance(vad, dict) or vad.get("create_response") is not False:
                        raise RuntimeError("Client-controlled VAD responses were not configured.")
                    break
        logger.info("Realtime session ready in %.1fs", asyncio.get_running_loop().time() - started)
        audio = BrowserAudio()

        async def notify(event):
            event["state"] = snapshot(settings.dispatcher, owner)
            if event.get("type") == "tool" and event.get("name") == "ground_public_answer":
                event["grounding"] = grounding_state(settings, owner)
            await socket.send_json(event)
            if event.get("type") == "tool":
                await broadcast_state(settings)

        session = Session(
            connection, CockpitDispatcher(settings.dispatcher.vehicle, owner, settings.grounding), audio, notify,
        )
        session_events: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=512)

        async def cloud_events():
            while True:
                event = await receive(connection)
                if session.in_tool and event.get("type") in {
                    "input_audio_buffer.speech_started", "input_audio_buffer.committed",
                }:
                    await session.handle(event)
                else:
                    await session_events.put(event)

        async def events():
            while True:
                deadlines = [
                    value for value in (
                        session.deadline if session.responding else None,
                        session.playback_ack_deadline,
                    ) if value is not None
                ]
                async with asyncio.timeout_at(min(deadlines) if deadlines else None):
                    await session.handle(await session_events.get())

        async def inputs():
            while True:
                packet = await incoming.get()
                if isinstance(packet, bytes):
                    await connection.input_audio_buffer.append(audio=packet)
                elif session.in_tool and packet.get("type") == "playback_interrupted":
                    await session.handle(packet)
                else:
                    await session_events.put(packet)

        async def watch_controls():
            await owner.disconnected.wait()
            await socket.send_json({
                "type": "error",
                "message": "Cockpit controls disconnected. Voice stopped. Reconnect controls, then reconnect voice.",
            })

        if owner.closed or owner.socket.closed:
            await socket.send_json({"type": "error", "message": "Cockpit controls disconnected during voice setup. Reconnect controls and voice."})
            return
        await socket.send_json({
            "type": "ready", "owner": owner.epoch,
            "capabilities": [tool["name"] for tool in session.dispatcher.response_tools()],
        })
        tasks = [
            asyncio.create_task(cloud_events()), asyncio.create_task(events()),
            asyncio.create_task(inputs()), asyncio.create_task(audio.send(socket)),
            asyncio.create_task(watch_controls()),
        ]
        try:
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)


async def read_browser(socket, incoming) -> None:
    # Read immediately, including during Azure setup, so heartbeat PONGs are processed.
    async for message in socket:
        if message.type == WSMsgType.BINARY:
            if not message.data or len(message.data) > 4800 or len(message.data) % 2:
                raise ValueError("Expected small 24 kHz PCM16 microphone chunks.")
            try:
                incoming.put_nowait(message.data)
            except asyncio.QueueFull as error:
                raise RuntimeError("Browser microphone upload is falling behind.") from error
        elif message.type == WSMsgType.TEXT:
            try:
                packet = json.loads(message.data)
            except json.JSONDecodeError as error:
                raise ValueError("Invalid browser playback acknowledgement.") from error
            if not isinstance(packet, dict) or packet.get("type") != "playback_interrupted":
                raise ValueError("Only PCM and playback acknowledgements are accepted.")
            try:
                incoming.put_nowait(packet)
            except asyncio.QueueFull as error:
                raise RuntimeError("Browser input queue is full.") from error
        elif message.type == WSMsgType.ERROR:
            raise RuntimeError("Browser voice socket failed.")


async def voice(request):
    settings = request.app[SETTINGS]
    if settings.demo:
        raise web.HTTPBadRequest(text="Offline mode has no cloud voice connection.")
    socket = web.WebSocketResponse(max_msg_size=32768, heartbeat=20)
    if settings.voice_active:
        await socket.prepare(request)
        await socket.send_json({
            "type": "error",
            "message": (
                "Another browser or tab is already connected to the voice agent. "
                "Disconnect voice in that browser or tab, then try again here. "
                "Only one voice session can be active at a time."
            ),
        })
        await socket.close()
        return socket
    if settings.limits and not settings.limits.admit("voice"):
        await socket.prepare(request)
        await socket.send_json({
            "type": "error",
            "message": (
                f"Public demo limit reached ({settings.limits.voice_starts} voice starts "
                "per rolling 24 hours, shared by all visitors). Please try again later."
            ),
        })
        await socket.close()
        return socket
    settings.voice_active = True
    tasks = []
    try:
        await socket.prepare(request)
        try:
            incoming: asyncio.Queue[bytes | dict[str, Any]] = asyncio.Queue(maxsize=200)
            tasks = [
                asyncio.create_task(read_browser(socket, incoming)),
                asyncio.create_task(cloud_session(request, socket, incoming)),
            ]
            expiry = None
            if settings.public_origin:
                expiry = asyncio.create_task(asyncio.sleep(settings.voice_session_seconds))
                tasks.append(expiry)
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            if expiry is not None and expiry in done:
                await socket.send_json({
                    "type": "error",
                    "message": "The public demo voice time limit was reached. Microphone stopped. You may reconnect if capacity remains.",
                })
            for task in done:
                task.result()
        except Exception:
            # Azure exceptions can contain endpoint/request details; keep those server-side.
            logger.exception("Cloud voice session failed")
            if not socket.closed:
                try:
                    await socket.send_json({
                        "type": "error",
                        "message": "Cloud voice failed. Check the server log, Azure login, and model configuration.",
                    })
                except ConnectionResetError:
                    logger.info("Browser disconnected before the error could be delivered.")
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await socket.close()
    finally:
        settings.voice_active = False
    return socket


def create_app(
    demo: bool, port: int, *, origin: str | None = None,
    limits: PublicDemoLimits | None = None, voice_session_seconds: float = 300,
) -> web.Application:
    if origin:
        origin = public_origin(origin)
        if limits is None:
            raise ValueError("Public hosting requires persistent usage limits.")
    if voice_session_seconds <= 0:
        raise ValueError("Voice session duration must be positive.")
    configure_console()
    app = web.Application(middlewares=[local_only], client_max_size=8192)
    app[SETTINGS] = Settings(
        demo, port, public_origin=origin, limits=limits,
        voice_session_seconds=voice_session_seconds,
        agent_name=os.getenv("AZURE_VOICE_AGENT_NAME") or None,
    )
    app[SETTINGS].grounding = WebIQ.from_environment(app[SETTINGS].dispatcher.vehicle)
    if app[SETTINGS].grounding.enabled and app[SETTINGS].grounding.health == "unconfigured":
        logger.warning("WebIQ is enabled without protected credentials. Local controls remain available.")
    app.cleanup_ctx.append(cloud_resources)
    app.add_routes([
        web.get("/", index), web.get("/health", health), web.get("/static/{name:.*}", asset),
        web.get("/api/state", state), web.post("/api/tool", manual_tool),
        web.get("/control", control), web.get("/ws", voice),
    ])
    return app


if __name__ == "__main__":
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env", override=False)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--demo", action="store_true", help="Offline cockpit; no Azure calls, microphone, or AI.")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--public-origin", default=os.getenv("PUBLIC_ORIGIN"))
    parser.add_argument("--voice-session-seconds", type=int, default=int(os.getenv("VOICE_SESSION_SECONDS", "300")))
    parser.add_argument("--voice-starts-per-day", type=int, default=int(os.getenv("VOICE_STARTS_PER_DAY", "20")))
    parser.add_argument("--usage-db", default=os.getenv("DEMO_USAGE_DB", "/home/data/vehicle-demo/usage.sqlite3"))
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("--port must be between 1024 and 65535.")
    origin = public_origin(args.public_origin) if args.public_origin else None
    limits = PublicDemoLimits(Path(args.usage_db), voice_starts=args.voice_starts_per_day) if origin else None
    print(f"COCKPIT. No vehicle hardware connected. Open {origin or f'http://127.0.0.1:{args.port}'}")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("azure").setLevel(logging.WARNING)
    web.run_app(
        create_app(args.demo, args.port, origin=origin, limits=limits, voice_session_seconds=args.voice_session_seconds),
        host="0.0.0.0" if origin else "127.0.0.1", port=args.port,
    )
