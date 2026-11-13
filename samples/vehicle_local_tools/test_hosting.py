import asyncio
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from aiohttp.test_utils import TestClient, TestServer

from hosting import PublicDemoLimits, public_origin
from server import SETTINGS, create_app


class HostingTests(unittest.TestCase):
    def test_public_origin_is_explicit_https_without_path_or_credentials(self):
        self.assertEqual(public_origin("https://cockpit.example"), "https://cockpit.example")
        for value in (
            "http://cockpit.example", "https://cockpit.example/", "https://user@cockpit.example",
            "https://cockpit.example:443", "https://cockpit.example?x=1", "https://cockpit.example#x",
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                public_origin(value)
        with self.assertRaisesRegex(ValueError, "persistent usage limits"):
            create_app(True, 8765, origin="https://cockpit.example")

    def test_limits_persist_across_restarts_and_expire_at_exact_boundary(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "usage.sqlite3"
            limits = PublicDemoLimits(path, voice_starts=2, manual_actions=1)
            with patch("hosting.time.time", return_value=100000):
                self.assertTrue(limits.admit("voice"))
                self.assertTrue(limits.admit("voice"))
                self.assertFalse(limits.admit("voice"))
                self.assertTrue(limits.admit("manual"))
                self.assertFalse(limits.admit("manual"))
            restarted = PublicDemoLimits(path, voice_starts=2, manual_actions=1)
            with patch("hosting.time.time", return_value=100059):
                self.assertFalse(restarted.admit("voice"))
                self.assertFalse(restarted.admit("manual"))
            with patch("hosting.time.time", return_value=100060):
                self.assertTrue(restarted.admit("manual"))
                self.assertFalse(restarted.admit("voice"))
            with patch("hosting.time.time", return_value=186400):
                self.assertTrue(restarted.admit("voice"))
            with self.assertRaises(ValueError):
                restarted.admit("unknown")


class PublicWebTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.limits = PublicDemoLimits(Path(self.directory.name) / "usage.sqlite3", voice_starts=1, manual_actions=1)
        self.client = TestClient(TestServer(create_app(
            True, 8765, origin="https://cockpit.example", limits=self.limits, voice_session_seconds=0.05,
        )))
        await self.client.start_server()
        self.headers = {"Host": "cockpit.example", "Origin": "https://cockpit.example"}

    async def asyncTearDown(self):
        await self.client.close()
        self.directory.cleanup()

    async def test_proxy_origin_health_disclosure_and_request_rejection(self):
        response = await self.client.get("/health", headers={"Host": "cockpit.example"})
        self.assertEqual(await response.json(), {"status": "ok"})
        response = await self.client.get("/api/state", headers=self.headers)
        info = await response.json()
        self.assertTrue(info["public_demo"])
        self.assertEqual(info["voice_session_seconds"], 0.05)
        self.assertEqual(info["voice_starts_per_day"], 1)
        for headers in (
            {"Host": "cockpit.example", "Origin": "https://untrusted.example"},
            {"Host": "untrusted.example", "Origin": "https://cockpit.example"},
            {"Host": "cockpit.example", "Origin": "http://cockpit.example"},
        ):
            response = await self.client.get("/api/state", headers=headers)
            self.assertEqual(response.status, 403)
        response = await self.client.get("/ws", headers={"Host": "cockpit.example"})
        self.assertEqual(response.status, 403)
        response = await self.client.post("/api/tool", headers={"Host": "cockpit.example"}, json={})
        self.assertEqual(response.status, 403)

    async def test_manual_rate_limit_is_json_and_does_not_change_vehicle_state(self):
        payload = {"name": "set_cabin_temperature", "arguments": {"temperature_c": 22}}
        response = await self.client.post("/api/tool", headers=self.headers, json=payload)
        self.assertEqual(response.status, 200)
        payload["arguments"]["temperature_c"] = 25
        response = await self.client.post("/api/tool", headers=self.headers, json=payload)
        self.assertEqual(response.status, 429)
        self.assertFalse((await response.json())["ok"])
        self.assertEqual(self.client.server.app[SETTINGS].dispatcher.vehicle.temperature_c, 22)

    async def test_driving_scene_module_is_served_but_test_modules_are_not(self):
        response = await self.client.get("/static/road-scene.mjs", headers=self.headers)
        self.assertEqual(response.status, 200)
        self.assertIn("export function createDrivingRoad", await response.text())
        response = await self.client.get("/static/test_road_scene.mjs", headers=self.headers)
        self.assertEqual(response.status, 404)

    async def test_voice_timeout_cancels_cloud_and_budget_blocks_reconnect(self):
        settings = self.client.server.app[SETTINGS]
        settings.demo = False
        cancelled = asyncio.Event()

        async def connected(_request, socket, _incoming):
            try:
                await socket.send_json({"type": "ready"})
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        with patch("server.cloud_session", side_effect=connected) as cloud:
            async with asyncio.timeout(5):
                socket = await self.client.ws_connect("/ws", headers=self.headers)
                self.assertEqual(await socket.receive_json(), {"type": "ready"})
                error = await socket.receive_json()
                self.assertEqual(error["type"], "error")
                self.assertIn("time limit", error["message"])
                await socket.close()
                await cancelled.wait()
                while settings.voice_active:
                    await asyncio.sleep(0)
                rejected = await self.client.ws_connect("/ws", headers=self.headers)
                error = await rejected.receive_json()
                self.assertEqual(error["type"], "error")
                self.assertIn("1 voice starts", error["message"])
                await rejected.close()
                self.assertFalse(settings.voice_active)
                cloud.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
