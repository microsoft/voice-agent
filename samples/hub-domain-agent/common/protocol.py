"""Shared HTTP Invocations SSE encoding and decoding."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

AI_SCOPE = "https://ai.azure.com/.default"
# Explicit request rejection, not an indeterminate 408/5xx or transport failure.
DEFINITIVE_CREATE_REJECTIONS = frozenset({400, 401, 403, 404, 429})


def sse(payload: dict[str, Any]) -> bytes:
    return ("data: " + json.dumps(payload, ensure_ascii=False) + "\n\n").encode()


async def sse_events(lines: AsyncIterator[str]) -> AsyncIterator[dict[str, Any]]:
    """Parse complete SSE frames; a truncated final frame is not success."""
    data: list[str] = []
    async for line in lines:
        if line.startswith("data:"):
            data.append(line[5:].lstrip())
        elif not line and data:
            value = json.loads("\n".join(data))
            if not isinstance(value, dict):
                raise ValueError("Expected an SSE JSON object")
            yield value
            data.clear()
    if data:
        raise RuntimeError("Truncated SSE frame")
