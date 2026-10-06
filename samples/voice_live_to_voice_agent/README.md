# Migrate Voice Live to Voice Agent

Two Python files demonstrate the same **cascaded pipeline: Azure Speech STT ->
GPT-4.1 mini -> Azure TTS**. This is not a speech-to-speech realtime model.

| Start with | Migrate to |
| --- | --- |
| [`voice_live.py`](voice_live.py): connect to Voice Live, then send session settings. | [`voice_agent.py`](voice_agent.py): save those settings in a Voice Agent, then connect by agent name. |

Both use `gpt-4.1-mini`, `azure-speech` recognition in `en-US`,
`en-US-Ava:DragonHDLatestNeural` (Ava HD) synthesis, the same instructions, mono PCM16 at 24 kHz,
Azure deep noise suppression, and server VAD with automatic replies and
interruption. [`migration_common.py`](migration_common.py) holds the shared
settings and conversation loop; microphone/playback use this folder's
[`migration_audio.py`](migration_audio.py), 

## Setup

Use Python 3.11 or later, Azure CLI (`az login`) or another
`DefaultAzureCredential` identity, a microphone, and a headset. Install PortAudio
if your OS needs it for `sounddevice`. Live sessions incur Azure charges.

You need a Voice Live-enabled Foundry resource and a Foundry Project supporting
Voice Agents and the managed `gpt-4.1-mini` model. Prefer the same resource/region
for both endpoints. Model and voice availability depend on resource, region, and
access; neither script changes models or falls back to a customer deployment.
Give your identity the required access to both Voice Live (Cognitive Services
User) and agent management/runtime in the Project.

From the repository root, in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r samples\voice_live_to_voice_agent\requirements.txt
Copy-Item samples\voice_live_to_voice_agent\.env.example samples\voice_live_to_voice_agent\.env
az login
```

On Linux/macOS, activate with `source .venv/bin/activate`, use `/` in paths,
and use `cp` instead of `Copy-Item`. Set these values in the folder's `.env`:

```dotenv
AZURE_VOICELIVE_ENDPOINT=https://<account>.services.ai.azure.com/
AZURE_VOICE_AGENTS_ENDPOINT=https://<account>.services.ai.azure.com/api/projects/<project>
```

The direct example explicitly uses Voice Live API `2026-04-10`; the migrated
example uses the Projects SDK's agent API and realtime connection route.

## Run before and after

```powershell
# Before: configuration belongs to this Voice Live session.
python samples\voice_live_to_voice_agent\voice_live.py

# After: configuration belongs to a reusable Voice Agent.
python samples\voice_live_to_voice_agent\voice_agent.py

# Reconnect using the name printed by the previous command.
python samples\voice_live_to_voice_agent\voice_agent.py --agent-name <printed-agent-name>

# Optional: publish and check settings without opening the microphone.
python samples\voice_live_to_voice_agent\voice_agent.py --create-only
```

Wait for `Ready`, then speak. Both print user/assistant transcripts, play the
answer, support barge-in, and exit with Ctrl+C. Service, transport, audio-device,
and settings-readback failures are surfaced rather than hidden.

Without `--agent-name`, each migrated run creates one new version of a uniquely
named agent and retains it. Delete demo agents in the Foundry portal when done.
Reusing an agent checks all sample settings and refuses a mismatch; it does not
overwrite the definition. Connecting enables the matching agent.
`--create-only` does not enable or connect. Conversation/audio persistence is
disabled (`store=False`); this does not disable service performance telemetry.

## Migrate with Codex

With Codex CLI installed, run this from the repository root:

```powershell
codex "Migrate samples\voice_live_to_voice_agent\voice_live.py to Foundry Voice Agent using azure-ai-projects. Write voice_agent.py in the same folder. Preserve the model, instructions, STT, Ava HD voice, audio format, VAD, and interruption settings. Reuse the local audio helper. Save settings in VoiceAgentDefinition and connect by agent name without session overrides."
```

This sample already includes `voice_agent.py` as the reference migration.
The command demonstrates the prompt to use when starting from the direct
Voice Live version; review any proposed changes to the existing reference file.

## What changes in the migration?

The device code, audio frames, event handling, and cascade components stay the
same. Replace direct `connect(model=MODEL)` plus `session.update(...)` with
`agents.create_version(definition=...)` once, then
`client.beta.voice_agents.realtime.connect(agent_name=...)` on subsequent runs.
The migrated script reads the saved definition back before connecting and sends
**no session overrides**.

| Direct Voice Live session | Saved Voice Agent definition |
| --- | --- |
| `connect(model=MODEL)` | `model=MODEL`, `model_type="managed"`, `kind="voice"` |
| `instructions` | `instructions` |
| `modalities` | `output_modalities` |
| `input_audio_format="pcm16"`, `input_audio_sampling_rate=24000` | `audio.input.format={"type":"audio/pcm","rate":24000}` |
| `output_audio_format="pcm16"` (24 kHz) | `audio.output.format={"type":"audio/pcm","rate":24000}` |
| `input_audio_transcription` | `audio.input.transcription` |
| `input_audio_noise_reduction` | `audio.input.noise_reduction` |
| `turn_detection` | `audio.input.turn_detection` |
| `voice={"type":"azure-standard","name":"en-US-Ava:DragonHDLatestNeural"}` | `audio.output.voice="en-US-Ava:DragonHDLatestNeural"`, `voice_type="azure-standard"` |

Voice Agent adds a versioned, reusable configuration in Foundry; tools,
knowledge, telephony, and observability can be added later. This focused example
does not add them, so the before/after conversation settings remain comparable.
It is a standalone terminal sample, not a portal Template.

See [Voice Live](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live)
and [configure a Voice Agent](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/configure-voice-agent).
