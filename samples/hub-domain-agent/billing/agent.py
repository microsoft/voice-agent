"""Billing implementation: read-only simulated billing answers, no Hub routing."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import aclosing
from typing import Any

from billing.prompts import PROMPT
from common.config import Config
from common.runtime import Runtime
from common.runtime import create_app as runtime_app


class BillingAgent(Runtime):
    def __init__(self, config: Config, *, warmup: bool = True) -> None:
        super().__init__(config, role="billing", prompt=PROMPT, warmup=warmup)

    async def answer(self, text: str) -> AsyncIterator[str]:
        self.last_route = "self"
        async with aclosing(self.text_answer(text)) as deltas:
            async for delta in deltas:
                yield delta


def create_app(config: Config, *, warmup: bool = True, **kwargs: Any):
    return runtime_app(BillingAgent(config, warmup=warmup), **kwargs)
