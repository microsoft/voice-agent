import copy
import json
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, patch

import yaml
from aiohttp.test_utils import TestClient, TestServer

from server import ACTIVE, MODELS, Settings, create_app, model_definition, redact_settings
from test_agent_creation import Client, Response


class ServiceClient(Client):
    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass


class ModelTests(unittest.IsolatedAsyncioTestCase):
    def definition(self):
        return json.loads(Path(__file__).with_name("personalized-agent.json").read_text())

    def agent(self, model="gpt-4.1", version="1"):
        definition = self.definition()
        definition["model"] = model
        return {"versions": {"latest": {"version": version, "definition": definition,
                                       "metadata": {"sample": "foundry_voice_webrtc", "custom": "keep"}}}}

    def test_switching_models_preserves_prompt_tools_and_previous_definition(self):
        original = self.definition()
        snapshot = copy.deepcopy(original)
        native = model_definition(original, "azure-realtime")
        self.assertEqual(original, snapshot)
        self.assertEqual(native["audio"]["output"]["voice_type"], "azure-realtime-native")
        self.assertEqual(native["audio"]["output"]["voice"], "ava")
        restored = model_definition(native, "gpt-4.1")
        self.assertEqual(restored["audio"]["output"]["voice"], "en-US-Tyler:DragonHDLatestNeural")
        self.assertEqual(restored["audio"]["input"]["transcription"]["model"], "azure-speech")
        for model in MODELS:
            result = model_definition(original, model)
            self.assertEqual(result["instructions"], original["instructions"])
            self.assertEqual(result["tools"], original["tools"])
            self.assertEqual(result["audio"]["input"]["noise_reduction"], original["audio"]["input"]["noise_reduction"])

    def test_explicitly_disabled_turn_detection_is_preserved(self):
        original = self.definition()
        original["audio"]["input"]["turn_detection"] = None
        self.assertIsNone(model_definition(original, "gpt-4.1")["audio"]["input"]["turn_detection"])

    async def test_save_new_model_version_then_enable_without_deleting(self):
        cfg = Settings("https://example.services.ai.azure.com/api/projects/demo", "demo-agent")
        service = ServiceClient([Response(200, self.agent()), Response(200, self.agent("azure-realtime", "2"))],
                                [Response(201, {"version": "2"}), Response(204)])
        async with TestClient(TestServer(create_app(cfg, AsyncMock()))) as client:
            origin = {"Origin": str(client.make_url("")).rstrip("/")}
            with patch("server.aiohttp.ClientSession", return_value=service):
                response = await client.post("/api/agent/model", headers=origin,
                    json={"model": "azure-realtime", "version": "1"})
                result = await response.json()
        self.assertEqual(response.status, 200, result)
        self.assertEqual(result["version"], "2")
        self.assertEqual(result["model"], "azure-realtime")
        self.assertEqual(service.removals, [])
        self.assertEqual(service.writes[0][1]["json"]["metadata"]["custom"], "keep")
        definition = service.writes[0][1]["json"]["definition"]
        self.assertEqual(definition["audio"]["output"]["voice_type"], "azure-realtime-native")
        self.assertIn(":enable", service.writes[1][0])

    async def test_stale_version_and_same_model_do_not_publish_an_extra_version(self):
        cfg = Settings("https://example.services.ai.azure.com/api/projects/demo", "demo-agent")
        for expected, version in ((409, "old"), (200, "1")):
            agent = self.agent()
            service = ServiceClient([Response(200, agent), Response(200, agent)], [Response(204)])
            async with TestClient(TestServer(create_app(cfg, AsyncMock()))) as client:
                with patch("server.aiohttp.ClientSession", return_value=service):
                    response = await client.post("/api/agent/model",
                        headers={"Origin": str(client.make_url("")).rstrip("/")},
                        json={"model": "gpt-4.1", "version": version})
                    self.assertEqual(response.status, expected)
            self.assertFalse(any("/versions" in url for url, _ in service.writes))

    async def test_invalid_requests_untrusted_origins_and_active_calls_are_blocked(self):
        cfg = Settings("https://example.services.ai.azure.com/api/projects/demo", "demo-agent")
        tokens = AsyncMock()
        app = create_app(cfg, tokens)
        async with TestClient(TestServer(app)) as client:
            origin = {"Origin": str(client.make_url("")).rstrip("/")}
            for body in ({}, [], {"model": "unknown", "version": "1"},
                         {"model": "gpt-4.1", "version": "1", "definition": {}}):
                response = await client.post("/api/agent/model", headers=origin, json=body)
                self.assertEqual(response.status, 400)
            response = await client.post("/api/agent/model", json={"model": "gpt-4.1", "version": "1"})
            self.assertEqual(response.status, 403)
            app[ACTIVE].active = True
            response = await client.post("/api/agent/model", headers=origin,
                                         json={"model": "gpt-4.1", "version": "1"})
            self.assertEqual(response.status, 409)
            tokens.get_token.assert_not_awaited()

    async def test_settings_yaml_uses_saved_version_and_redacts_credentials(self):
        cfg = Settings("https://example.services.ai.azure.com/api/projects/demo", "demo-agent")
        latest = self.agent()["versions"]["latest"]
        latest["definition"]["tools"].append({"type": "mcp", "headers": {"Authorization": "do-not-export"}})
        async with TestClient(TestServer(create_app(cfg, AsyncMock()))) as client:
            with patch("server.lookup_configured_agent", AsyncMock(return_value=latest)):
                response = await client.get("/api/agent/settings")
                result = await response.json()
        self.assertEqual(response.status, 200)
        self.assertNotIn("do-not-export", result["yaml"])
        self.assertIn("instructions: |", result["yaml"])
        settings = yaml.safe_load(result["yaml"])
        self.assertEqual(settings["version"], "1")
        self.assertEqual(settings["definition"]["model"], "gpt-4.1")
        self.assertEqual(redact_settings({"api-key": "secret"}), {"api-key": "[redacted]"})
