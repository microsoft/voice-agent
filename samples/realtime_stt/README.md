# Realtime STT agent

Create a Foundry voice-first agent that detects utterance boundaries with VAD, transcribes speech, and preserves cumulative session token usage when the endpoint supplies it. Choose MAI Transcribe 2 or Azure Speech. The saved agent definition sets create_response=false, has no greeting, and never requests response.create. The client stops with an error if it receives an unexpected response event.

The default managed session model is gpt-5.6-luna; selecting it does not request language-model inference. Azure Speech uses the public identifier azure-speech; its backend routing depends on regional configuration. The older azure-fast-transcription model name is not used.

## Setup

Use Python 3.13+, a Foundry project with Voice Agent access, and an Azure identity with permission to create and run agents. This standalone sample supports Windows PowerShell as well as Linux. Run commands from the repository root.

Install into your existing virtual environment:

~~~text
uv pip install --python .venv/Scripts/python.exe -r samples/realtime_stt/requirements.txt
az login
~~~

Set AZURE_VOICE_AGENTS_ENDPOINT to the project endpoint copied from Foundry. Its form is shown in [.env.example](.env.example). You can also add that variable to the existing samples/.env; authentication uses DefaultAzureCredential, including Azure CLI sign-in. Do not add keys or bearer tokens to source files.

## Run with a microphone

~~~text
.venv/Scripts/python.exe -m samples.realtime_stt.sample --duration 30 --output result.json
~~~

Each completed utterance appears immediately on stdout as Recognized: followed by the text. This also works with WAV input; no extra flag is required. Transcript output uses a dedicated console logger that does not propagate into ordinary diagnostic logs.

The microphone records mono PCM16 at 24 kHz. The sample sends two seconds of silence after capture so VAD can commit the final utterance. PortAudio is required on Linux; the Windows sounddevice package supplies its audio runtime.

## Run with a WAV

Use an uncompressed mono, 16-bit PCM WAV at 24 kHz. Input is paced in real time, and the shared audio source adds trailing silence.

~~~text
.venv/Scripts/python.exe -m samples.realtime_stt.sample --wav speech.wav --output result.json
.venv/Scripts/python.exe -m samples.realtime_stt.sample --wav speech.wav --stt-model azure-speech --output result-azure.json
.venv/Scripts/python.exe -m samples.realtime_stt.sample --wav speech.wav --vad azure_semantic_vad_multilingual --output result-semantic.json
~~~

By default each run creates and retains a new agent. To reuse an agent without changing it, pass --agent-name with the same STT and VAD selections. A nonexistent --agent-name fails; omit --agent-name to create a new agent. The client verifies the stored definition and effective session configuration before sending audio.

The saved definition enables conversation storage (store=true), matching the common agent samples. The sample does not download conversation artifacts. Transcripts are saved to a local file only when --output is supplied; an existing output file is never overwritten.

The session deadline is 180 seconds, and each readiness, input, transcription, or final-event wait is bounded at 60 seconds. Keep WAV recordings and microphone captures shorter than 60 seconds for this sample.

## Return transcripts and tokens

~~~python
import asyncio
from pathlib import Path

from samples.realtime_stt.sample import Options, run

result = asyncio.run(
    run(
        Options(
            endpoint=project_endpoint,
            wav=Path("speech.wav"),
            stt_model="mai-transcribe-2",
        )
    )
)

transcripts = [item.text for item in result.transcripts]
usage_complete = result.usage_status == "complete"
audio_tokens = None
if result.usage is not None:
    audio_tokens = result.usage["input_token_details"]["audio_tokens"]
~~~

The result includes the agent name/version, session/event identifiers, close reason, all completed utterances, event counts, usage_status, and the original usage object when one is delivered. The client has one WebSocket receiver throughout the session, tracks every committed item, waits for transcription completion, sends session.close, and waits for session.closed before closing the transport. Some deployed endpoints close normally without that event; the result then marks usage as unconfirmed.

Usage is cumulative for the whole session, rather than a per-utterance count. Preserve status and incomplete_components. Partial or unavailable usage is returned with its original status; a normal requested closure without the final event returns usage=null and usage_status=unconfirmed. Transport failures and timeouts remain errors. Pass --require-usage to fail unless complete usage arrives; missing usage never becomes a zero-token result. Do not infer token usage from transcript length or uploaded audio duration. Final usage support also depends on the deployed Voice Agent relay and its Voice Live backend.

## Validation

Mocked tests verify configuration, multiple utterances, receiver failures, unexpected model responses, and preservation of partial usage:

~~~text
uv pip install --python .venv/Scripts/python.exe pytest
.venv/Scripts/python.exe -m pytest samples/realtime_stt/test_sample.py -q
~~~

Live tests create and retain four agents, covering both STT models and both VAD types. Set STT_LIVE_TEST=1, AZURE_VOICE_AGENTS_ENDPOINT, and STT_LIVE_WAV before running them. STT_LIVE_WAV must contain the spoken question about the largest lake used by the test assertions; the Voice Live repository's tests/data/largest_lake.wav is a suitable fixture.

~~~text
.venv/Scripts/python.exe -m pytest samples/realtime_stt/test_live.py -v --log-cli-level=INFO
~~~

The live checks require VAD speech boundaries, completed transcription, and no response events. They also validate complete positive input-audio usage with zero text-input/output tokens when a final event arrives; otherwise they require an explicit unconfirmed result with no fabricated usage. They are skipped unless explicitly enabled. Agent deletion is a separate, explicit cleanup action.

See [Configure a voice agent](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/configure-voice-agent) for the persisted definition and [the SDK quickstart](https://learn.microsoft.com/en-us/azure/foundry/agents/quickstarts/prompt-voice-agent) for the project-scoped voice endpoint.

## Observed endpoint limitation

The tested Foundry dev endpoint completed both MAI and Azure Speech transcription with both VAD modes and disabled responses, then closed normally after session.close without forwarding session.closed. Direct Voice Live tests returned final tokens successfully; that success does not establish parity for the voice-first API. The sample preserves transcription and reports usage as unconfirmed on this deployed behavior. Use --require-usage when token retrieval is mandatory. That endpoint must expose the final usage event before this client can provide a confirmed token total.
