"""Managed MAI companion, model switching, and session regressions."""

import copy
import json
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, patch

import aiohttp
from aiohttp.test_utils import TestClient, TestServer

from live import live_definition
from scenarios import scenario_definition
from server import (MAI_MODEL, AgentPreparationError, SessionConfiguration,
                    SessionConfigurationError, Settings, create_app, forward_browser,
                    lookup_configured_agent, mai_definition)
from test_agent_creation import Response
from test_model_management import ServiceClient


async def frames(events):
    for event in events:
        yield aiohttp.WSMessage(aiohttp.WSMsgType.TEXT, json.dumps(event), "")


class MaiTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.cfg = Settings("https://east.services.ai.azure.com/api/projects/east", "demo-agent",
                            live_project_endpoint="https://live.services.ai.azure.com/api/projects/live",
                            mai_project_endpoint="https://sweden.services.ai.azure.com/api/projects/sweden")
        self.source = json.loads(Path(__file__).with_name("personalized-agent.json").read_text())

    def saved(self, definition, version, metadata=None):
        return {"versions": {"latest": {"version": version, "definition": definition,
                                       "metadata": metadata or {}}}}

    def mai_agent(self, version="2"):
        metadata = {"sample": "foundry_voice_webrtc", "voice_companion_for": self.cfg.agent,
                    "realtime_source_version": "9", "microsoft.voice-live.enabled": "false"}
        return self.saved(mai_definition(self.source), version, metadata)

    def live_agent(self):
        definition = live_definition(self.source, "live-deployment", "backend")
        return self.saved(definition, "3", {"sample": "foundry_voice_webrtc", "companion_of": self.cfg.agent})

    def test_definition_preserves_source_but_uses_caller_first_native_audio_without_tools(self):
        before = copy.deepcopy(self.source)
        definition = mai_definition(self.source)
        self.assertEqual(self.source, before)
        self.assertEqual((definition["model"], definition["model_type"], definition["sub_protocol"]),
                         (MAI_MODEL, "managed", "realtime"))
        self.assertEqual(definition["audio"]["input"]["format"], {"type": "audio/pcm", "rate": 24000})
        self.assertEqual(definition["audio"]["output"], {"format": {"type": "audio/pcm", "rate": 24000}})
        self.assertEqual(definition["output_modalities"], ["audio"])
        self.assertNotIn("transcription", definition["audio"]["input"])
        self.assertNotIn("tools", definition)
        self.assertNotIn("greeting", definition)
        self.assertNotIn("WEB SEARCH", definition["instructions"])
        self.assertIn("Wait for the caller", definition["instructions"])
        self.assertEqual(definition["structured_inputs"], self.source["structured_inputs"])

        scenario = scenario_definition(definition, "banking")
        self.assertNotIn("greeting", scenario)
        self.assertFalse(scenario["tools"])
        self.assertIn("Wait for the caller", scenario["instructions"])
        self.assertIn("fictional", scenario["instructions"])

    def test_companions_are_distinct_and_use_the_configured_projects(self):
        self.assertEqual(self.cfg.project_url(), "https://east.services.ai.azure.com/api/projects/east")
        self.assertEqual(self.cfg.mai_companion().project_url(),
                         "https://sweden.services.ai.azure.com/api/projects/sweden")
        self.assertEqual(self.cfg.live_companion().project_url(),
                         "https://live.services.ai.azure.com/api/projects/live")
        self.assertEqual(self.cfg.mai_companion().agent, "demo-agent-mai")
        self.assertEqual(self.cfg.mai_companion().companion_for, self.cfg.agent)
        self.assertEqual(Settings(self.cfg.endpoint, self.cfg.agent).mai_companion().endpoint, self.cfg.endpoint)

    async def test_creation_publishes_only_the_separate_owned_mai_agent_and_verifies_readback(self):
        source = self.saved(self.source, "9")
        destination = self.mai_agent()
        service = ServiceClient([
            Response(200, source), Response(404), Response(200), Response(404), Response(200),
            Response(200, destination),
        ], [Response(201, {"version": "2"}), Response(204)])
        async with TestClient(TestServer(create_app(self.cfg, AsyncMock()))) as client:
            with patch("server.aiohttp.ClientSession", return_value=service):
                response = await client.post("/api/agent/model",
                    headers={"Origin": str(client.make_url("")).rstrip("/")},
                    json={"model": MAI_MODEL, "version": "9"})
                result = await response.json()
        self.assertEqual(response.status, 200, result)
        self.assertEqual((result["agent"], result["model"], result["version"]),
                         (self.cfg.mai_companion().agent, MAI_MODEL, "2"))
        self.assertIsNone(result["transcriptionModel"])
        self.assertTrue(service.writes[0][0].startswith(self.cfg.mai_companion().project_url()))
        self.assertIn("/agents/demo-agent-mai/versions", service.writes[0][0])
        self.assertEqual(service.writes[0][1]["json"], {
            "definition": destination["versions"]["latest"]["definition"],
            "metadata": destination["versions"]["latest"]["metadata"],
        })
        self.assertEqual(service.removals, [])

    async def test_existing_companions_switch_between_projects_without_republishing(self):
        original, mai, live = self.saved(self.source, "9"), self.mai_agent(), self.live_agent()
        cases = [
            ("demo-agent", "9", MAI_MODEL, [original, mai, mai], "demo-agent-mai"),
            ("demo-agent-mai", "2", "gpt-live-1", [mai, original, live, live], "demo-agent-live"),
            ("demo-agent-live", "3", MAI_MODEL, [live, original, mai, mai], "demo-agent-mai"),
            ("demo-agent-mai", "2", self.source["model"], [mai, original, original], "demo-agent"),
        ]
        for selected, version, target, reads, expected in cases:
            with self.subTest(selected=selected, target=target):
                service = ServiceClient([Response(200, item) for item in reads], [Response(204)])
                async with TestClient(TestServer(create_app(self.cfg, AsyncMock()))) as client:
                    with patch("server.aiohttp.ClientSession", return_value=service):
                        response = await client.post(f"/api/agent/model?agent={selected}",
                            headers={"Origin": str(client.make_url("")).rstrip("/")},
                            json={"model": target, "version": version})
                        result = await response.json()
                self.assertEqual(response.status, 200, result)
                self.assertEqual(result["agent"], expected)
                self.assertEqual(len(service.writes), 1)
                self.assertIn(f"/agents/{expected}:enable", service.writes[0][0])
                self.assertEqual(service.removals, [])

    async def test_collision_and_concurrent_creation_do_not_overwrite_another_agent(self):
        source, mai = self.saved(self.source, "9"), self.mai_agent()
        foreign = copy.deepcopy(mai)
        foreign["versions"]["latest"]["metadata"]["voice_companion_for"] = "another-agent"
        for reads in (
                [Response(200, source), Response(200, foreign)],
                [Response(200, source), Response(404), Response(200), Response(200, mai)]):
            service = ServiceClient(reads)
            async with TestClient(TestServer(create_app(self.cfg, AsyncMock()))) as client:
                with patch("server.aiohttp.ClientSession", return_value=service):
                    response = await client.post("/api/agent/model",
                        headers={"Origin": str(client.make_url("")).rstrip("/")},
                        json={"model": MAI_MODEL, "version": "9"})
                    self.assertIn(response.status, {409, 502}, await response.text())
            self.assertEqual(service.writes, [])

    async def test_ownership_check_rejects_wrong_protocol_and_model(self):
        for field, value in (("sub_protocol", "live"), ("model_type", "self_deployed"), ("model", "other")):
            agent = self.mai_agent()
            agent["versions"]["latest"]["definition"][field] = value
            with self.subTest(field=field), self.assertRaises(AgentPreparationError):
                await lookup_configured_agent(ServiceClient([Response(200, agent)]), self.cfg.mai_companion(), {})

    async def test_unsupported_mai_overrides_are_rejected_before_credentials(self):
        tokens = AsyncMock()
        async with TestClient(TestServer(create_app(self.cfg, tokens))) as client:
            for extra in ({"transcriptionModel": "whisper-1"}, {"enhancedTurnDetection": True}):
                response = await client.post("/api/agent/model",
                    headers={"Origin": str(client.make_url("")).rstrip("/")},
                    json={"model": MAI_MODEL, "version": "9", **extra})
                self.assertEqual(response.status, 400)
        tokens.get_token.assert_not_awaited()

    async def test_mai_webrtc_is_rejected_before_connecting_to_azure(self):
        tokens = AsyncMock()
        async with TestClient(TestServer(create_app(self.cfg, tokens))) as client:
            origin = str(client.make_url("")).rstrip("/")
            async with client.ws_connect(
                    "/api/voice?transport=webrtc&agent=demo-agent-mai",
                    headers={"Origin": origin}) as socket:
                frame = await socket.receive_json()
        self.assertEqual(frame["type"], "bridge.error")
        self.assertIn("uses WebSocket", frame["error"]["message"])
        tokens.get_token.assert_not_awaited()

    async def test_session_waits_for_saved_update_and_never_sends_unsupported_configuration(self):
        for stable in (True, False):
            vad = {"type": "azure_semantic_vad", "auto_truncate": False,
                   "interrupt_response": True, "create_response": True}
            session = {"id": "session-one", "model": MAI_MODEL}
            session.update({"audio": {"input": {"turn_detection": vad}}} if stable else {"turn_detection": vad})
            configuration, upstream = SessionConfiguration(), AsyncMock()
            self.assertFalse(await configuration.observe({"type": "session.created", "session": session}, upstream))
            self.assertFalse(configuration.ready)
            self.assertTrue(await configuration.observe({"type": "session.updated", "session": session}, upstream))
            self.assertEqual(configuration.model, MAI_MODEL)
            upstream.send_json.assert_not_awaited()
            invalid = copy.deepcopy(session)
            invalid_vad = invalid["audio"]["input"]["turn_detection"] if stable else invalid["turn_detection"]
            invalid_vad["auto_truncate"] = True
            with self.assertRaises(SessionConfigurationError):
                await SessionConfiguration().observe({"type": "session.updated", "session": invalid}, upstream)

    async def test_mai_accepts_bare_response_but_rejects_text_only_override(self):
        config, upstream = SessionConfiguration(ready=True, model=MAI_MODEL), AsyncMock()
        await forward_browser(frames([{"type": "response.create"}]), upstream, "websocket", config)
        upstream.send_json.assert_awaited_once_with({"type": "response.create"})
        with self.assertRaisesRegex(SessionConfigurationError, "audio"):
            await forward_browser(frames([{
                "type": "response.create", "response": {"output_modalities": ["text"]},
            }]), AsyncMock(), "websocket", config)
