# Copyright (c) Microsoft. All rights reserved.
"""Portal-owned Handoff Graph authoring routes and static assets."""

from __future__ import annotations

from pathlib import Path

from aiohttp import web


STATIC_DIR = Path(__file__).resolve().parent / "static" / "handoff"
HANDOFF_ASSETS = frozenset({
    "handoff-app.js",
    "handoff-core.mjs",
    "handoff.css",
})


async def handoff_index(_request: web.Request) -> web.FileResponse:
    return web.FileResponse(STATIC_DIR / "handoff.html")


async def handoff_asset(request: web.Request) -> web.FileResponse:
    name = request.match_info["asset"]
    if name not in HANDOFF_ASSETS:
        raise web.HTTPNotFound()
    return web.FileResponse(STATIC_DIR / name)


def install_handoff_routes(app: web.Application) -> None:
    app.router.add_get("/handoff", handoff_index)
    app.router.add_get("/handoff/", handoff_index)
    app.router.add_get("/static/handoff/{asset}", handoff_asset)
