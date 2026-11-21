"""Shared model-boundary fixtures and SSE collection, not business implementations."""

import json
from types import SimpleNamespace as NS


class Stream:
    def __init__(self, events):
        self.events = events
        self.closed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        self.closed = True

    async def __aiter__(self):
        for event in self.events:
            yield event


def direct(text="Hello!"):
    return [NS(type="response.output_text.delta", delta=text), NS(type="response.completed")]


def tool(role="billing", arguments="{}"):
    item = NS(type="function_call", id="call-one", name=role, arguments=arguments)
    return [
        NS(type="response.output_item.added", item=item),
        NS(type="response.output_item.done", item=item),
        NS(type="response.completed"),
    ]


async def collect(runtime, text="Question"):
    raw = b"".join([part async for part in runtime.stream(text)])
    return [json.loads(frame[6:]) for frame in raw.decode().strip().split("\n\n")]
