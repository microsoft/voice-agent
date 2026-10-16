# Copyright (c) Microsoft. All rights reserved.
"""Handoff Graph portal routes and customer-facing static contracts."""

from __future__ import annotations

import unittest
from pathlib import Path

from aiohttp.test_utils import TestClient, TestServer

import demo_server
from template_portal import iter_mcp_tools


ROOT = Path(__file__).resolve().parents[1]
ENDPOINT = "https://sample.services.ai.azure.com/api/projects/sample-project"


class HandoffPortalRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        args = demo_server.parse_args([
            "--project-endpoint",
            ENDPOINT,
            "--no-record-sessions",
        ])
        self.client = TestClient(TestServer(demo_server.build_app(args)))
        await self.client.start_server()

    async def asyncTearDown(self) -> None:
        await self.client.close()

    async def test_handoff_page_and_allowlisted_assets_are_served(self) -> None:
        response = await self.client.get("/handoff/")
        self.assertEqual(200, response.status)
        self.assertEqual("DENY", response.headers["X-Frame-Options"])
        markup = await response.text()
        self.assertIn("Handoff Graph · Voice Agents", markup)
        self.assertIn('aria-label="Portal pages"', markup)
        self.assertNotIn(">Dashboard<", markup)

        for asset in ("handoff-app.js", "handoff-core.mjs", "handoff.css"):
            with self.subTest(asset=asset):
                response = await self.client.get(f"/static/handoff/{asset}")
                self.assertEqual(200, response.status)
                self.assertGreater(len(await response.read()), 0)
        self.assertEqual(
            404,
            (await self.client.get("/static/handoff/handoff.html")).status,
        )

    async def test_template_detail_supports_handoff_working_copies(self) -> None:
        response = await self.client.get(
            "/api/templates/elevator-service-example"
        )
        self.assertEqual(200, response.status)
        detail = await response.json()
        self.assertEqual("voice", detail["definition"]["kind"])
        self.assertGreater(
            len(detail["definition"]["handoff"]["nodes"]),
            1,
        )
        for node in detail["definition"]["handoff"]["nodes"]:
            config = node["config"]
            self.assertNotIn("inherit_from_base_instructions", config)
            self.assertTrue(config["instructions"].startswith("## GLOBAL POLICY\n"))
            self.assertIn("\n\n## CURRENT NODE\n", config["instructions"])
        self.assertRegex(
            detail["suggested_agent_name"],
            r"^local-only-elevator-service-example-[0-9a-f]{8}$",
        )
        for tool in iter_mcp_tools(detail["definition"]):
            self.assertNotIn("authorization", tool)
            self.assertNotIn("headers", tool)


class HandoffPortalStaticContractTests(unittest.TestCase):
    def test_editor_runtime_and_navigation_contracts_remain_connected(self) -> None:
        html = (
            ROOT / "static/handoff/handoff.html"
        ).read_text(encoding="utf-8")
        app = (
            ROOT / "static/handoff/handoff-app.js"
        ).read_text(encoding="utf-8")
        studio = (
            ROOT / "web/src/App.jsx"
        ).read_text(encoding="utf-8")
        studio_header = (
            ROOT / "web/src/components/StudioHeader.jsx"
        ).read_text(encoding="utf-8")
        templates = (
            ROOT / "static/templates.html"
        ).read_text(encoding="utf-8")

        self.assertIn("Load from templates", html)
        self.assertIn("Publish &amp; run", html)
        self.assertEqual(1, html.count('id="publish-run-action"'))
        self.assertNotIn('id="publish-action"', html)
        self.assertIn('id="publish-progress"', html)
        for step in ("validate", "mcp", "publish", "verify", "open"):
            self.assertIn(f'data-publish-step="{step}"', html)
        self.assertNotIn('id="save-draft-action"', html)
        self.assertIn('fetch(`/api/templates/${encodeURIComponent(templateId)}`)', app)
        self.assertIn("/mcp/configure", app)
        self.assertIn("openPublishProgress()", app)
        self.assertIn('setPublishStep("verify", "running"', app)
        self.assertIn("detail.definition", app)
        self.assertNotIn("publishDefinition(true)", app)
        self.assertIn("view=handoff", app)
        self.assertIn('get("view") === "handoff"', studio)
        self.assertIn('href="/handoff/"', studio_header)
        self.assertIn('href="/handoff/"', templates)


if __name__ == "__main__":
    unittest.main()
