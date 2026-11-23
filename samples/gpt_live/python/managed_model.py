#!/usr/bin/env python3
"""Talk to a GPT Live agent on a managed GPT Live model that Voice Live hosts (model_type=managed).

Its Responses backend can call a local get_current_datetime function, which this app runs.
"""

from pathlib import Path

from azure.ai.projects.models import (
    LiveFunctionToolInputParam,
    LiveResponsesDelegationSettingsInputParam,
    VoiceAgentLiveDefinition,
    VoiceAgentLiveResponsesDelegation,
)

import response_delegation as sample
from prompt_agent_delegation_tools import DATETIME_TOOL_NAME, ManagedToolHandler
from response_delegation import (
    BACKEND_INSTRUCTIONS,
    ENGLISH_TEACHER_INSTRUCTIONS,
    LESSON_CONTEXT,
    RESPONSES_POLICY,
    lesson_greeting,
    lesson_inputs,
    live_audio,
)

# Voice Live hosts these models and their Responses backends, so the project needs no
# GPT Live or text deployment. The service checks both against the region's Voice Live
# when the agent is saved and returns HTTP 400 for a model or backend it does not offer.
MANAGED_MODELS = ("gpt-live-1-datazone", "gpt-live-1")
MANAGED_BACKENDS = ("gpt-6.1-sol", "gpt-6-luna")
# Voice Live audio processing, available for managed models only.
VOICE_LIVE_INPUT = {
    "noise_reduction": {"type": "azure_deep_noise_suppression"},
    "echo_cancellation": {"type": "server_echo_cancellation"},
}
# With --input-wav, keep sending silence this long after the file so the agent can answer.
WAV_TAIL_SECONDS = 20
# GPT Live hands date/time questions to the backend, and the backend calls the local
# function, which this app runs on the learner's computer.
DATETIME_POLICY = (
    " Also always delegate questions about the current date or time to the backend; it "
    "reads the learner's computer clock. Do not guess the date or time yourself."
)
BACKEND_TOOL_INSTRUCTIONS = (
    " For the current date or time, always call get_current_datetime and answer from its "
    "result; its local time and timezone belong to the learner's computer. Never guess "
    "the date or time. After the result arrives, answer; do not call it again."
)


def datetime_tool():
    """A no-argument function the backend calls; this app runs it and returns the result."""
    return LiveFunctionToolInputParam(
        name=DATETIME_TOOL_NAME,
        description=(
            "Get the current date and time on the learner's computer, including its local "
            "timezone/UTC offset and the corresponding UTC time."
        ),
        parameters={"type": "object", "properties": {}, "required": [], "additionalProperties": False},
        strict=True,
    )


def agent_definition(model=MANAGED_MODELS[0], backend=MANAGED_BACKENDS[0]):
    """A GPT Live English teacher on a managed model, delegating to a managed Responses backend."""
    definition = VoiceAgentLiveDefinition(
        # Projects SDK 2.11.0 types Live model_type as "self_deployed" only; the service
        # also accepts "managed", and the SDK sends the value unchanged.
        model_type="managed",
        model=model,
        instructions=ENGLISH_TEACHER_INSTRUCTIONS + LESSON_CONTEXT + RESPONSES_POLICY + DATETIME_POLICY,
        greeting=lesson_greeting(),
        structured_inputs=lesson_inputs(),
        audio=live_audio(),
        # A managed model delegates to one of its own Responses backends, not to a
        # deployment in your project. Function tools work there; web search does not.
        delegation=VoiceAgentLiveResponsesDelegation(
            responses=LiveResponsesDelegationSettingsInputParam(
                model=backend,
                instructions=BACKEND_INSTRUCTIONS + BACKEND_TOOL_INSTRUCTIONS,
                tools=[datetime_tool()],
            )
        ),
        # Persist in Foundry for the shared conversation downloader.
        store=True,
    )
    # SDK 2.11.0 does not model Live audio.input yet, so set its JSON directly.
    definition["audio"]["input"] = dict(VOICE_LIVE_INPUT)
    return definition


async def main(*, model, backend, input_wav=None, auto_delete=False, **lesson):
    # Always create a managed-model agent; AGENT_NAME is for response_delegation.py.
    await sample.main(
        auto_delete=auto_delete,
        definition_factory=lambda: agent_definition(model, backend),
        reuse_agent_name=False,
        # A WAV file replaces the microphone; without speakers, its replies are only shown.
        audio_options=(
            {"input_wav": input_wav, "no_playback": True, "tail_seconds": WAV_TAIL_SECONDS}
            if input_wav
            else None
        ),
        # Runs the backend's get_current_datetime calls on this computer and resumes it.
        event_handler=ManagedToolHandler(title="Local function", resumes="the Responses backend"),
        **lesson,
    )


def add_arguments(parser):
    parser.add_argument(
        "--model",
        default=MANAGED_MODELS[0],
        help=f"Managed GPT Live model (default {MANAGED_MODELS[0]}; also {', '.join(MANAGED_MODELS[1:])}).",
    )
    parser.add_argument(
        "--backend",
        default=MANAGED_BACKENDS[0],
        help=f"The managed model's Responses backend (default {MANAGED_BACKENDS[0]}; "
        f"also {', '.join(MANAGED_BACKENDS[1:])}).",
    )
    parser.add_argument(
        "--input-wav",
        type=Path,
        help="Speak a 24 kHz mono PCM16 WAV instead of the microphone, then end the session "
        f"{WAV_TAIL_SECONDS} seconds after it. Replies are shown, not played.",
    )


if __name__ == "__main__":
    sample.run_cli(main, description=__doc__, add_arguments=add_arguments)
