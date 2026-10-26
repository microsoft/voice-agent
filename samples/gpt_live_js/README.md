# Foundry GPT Live with the Azure AI Projects SDK for JavaScript

JavaScript versions of the [Python GPT Live samples](../gpt_live/README.md): English-teacher
voice agents that create or reuse agents in an existing Foundry project, stream a spoken
question through a GPT Live session, and print user/teacher transcripts and delegation
status. Choose direct Responses delegation or a versioned managed prompt agent.

Agents are created, read back, and deleted through `AIProjectClient.agents`, and audio
sessions use the SDK's Live WebSocket client, `project.beta.voiceAgents.live.connect(...)`,
with the same credential. These GPT Live APIs are not in an npm release yet, so
`package.json` installs the bundled preview package
`dist/azure-ai-projects-2.10.0.tgz`; see [`dist/README.md`](../../dist/README.md) for its
source and checksum.

## Files

| File | Description |
| --- | --- |
| `response_delegation.mjs` | Checks deployments, creates or reuses a GPT Live agent with Responses delegation, runs the voice conversation, and prints its ID and download command. |
| `prompt_agent_delegation.mjs` | Creates a prompt agent first, creates a GPT Live voice agent pinned to it, and runs the shared voice conversation. |
| `live_common.mjs` | Settings, the Projects SDK client, WAV audio, error hints, and the shared Live event loop. |
| `test/samples.test.mjs` | Offline payload, lifecycle, and Live event tests. |
| `package.json` / `package-lock.json` | Dependencies, including the bundled preview `@azure/ai-projects` package. |
| `.env.example` | Configuration template. |
| `.env` | Your local project, agent, deployment, and subscription settings; git-ignored. |

## How to run

Requires Node.js 22+, Azure CLI, and a Foundry project with the Voice Agents / GPT Live
preview, a GPT Live deployment, and a Responses deployment. From this folder, in PowerShell:

```powershell
az login
npm ci
if (-not (Test-Path -LiteralPath .env)) { Copy-Item .env.example .env }
```

`npm ci` installs the bundled package from `../../dist` (the path is relative to
`package.json`) and the other dependencies at their locked versions. The lockfile records
the public npm registry; npm uses your configured registry instead when you have one.

In `.env`, set `FOUNDRY_PROJECT_ENDPOINT` and the deployments, exactly as for the Python
samples. Authentication uses your `az login` account through `AzureCliCredential`; no API
keys or manually copied tokens are needed. If you have multiple signed-in subscriptions, set
`AZURE_SUBSCRIPTION_ID`. Leave `AGENT_NAME` blank to create a new English-teacher agent, or
set it to reuse an existing GPT Live agent's latest version and saved configuration without
creating, updating, or deleting it.

### Record a question

Node.js has no built-in microphone or speaker access, and these samples avoid native audio
add-ons. Instead, they stream a recorded question in real time and can save the teacher's
spoken reply. The input must be an uncompressed WAV file: PCM16, mono, 24 kHz. On Windows,
you can synthesize one:

```powershell
Add-Type -AssemblyName System.Speech
$speech = New-Object System.Speech.Synthesis.SpeechSynthesizer
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$speech.SetOutputToWaveFile("$PWD\question.wav", $format)
$speech.Speak("Please correct my English: I goed to school yesterday. Explain why.")
$speech.Dispose()
```

Or convert your own recording with `ffmpeg -i recording.m4a -ac 1 -ar 24000 -sample_fmt s16 question.wav`.
WAV files in this folder are git-ignored.

### Responses delegation

```powershell
node response_delegation.mjs --input question.wav --output reply.wav
```

The sample sends the question in real-time 100 ms chunks, then silence, because Live has no
end-of-input or reply-finished event. It closes the session once delegated work has finished
and the teacher has been quiet for 5 seconds (low-level output audio counts as quiet), or
when you press **Ctrl+C**. A long pause in the reply can end it early. It then prints the
Foundry conversation ID and a command for the shared Python
[`download_conversation_artifacts.py`](../download_conversation_artifacts.py); run that from
the repository root with the Python setup in [`samples/README.md`](../README.md).

New agents use `store: true` and are kept by default; add `--auto-delete` to delete only an
agent created by this run. Existing agents are never deleted. The Responses backend's
guidance is printed after each `response.completed`, separately from what the teacher says.
A client-target delegation receives commentary tied to its ID; backend failures stop the run.

### Managed prompt-agent delegation

```powershell
node prompt_agent_delegation.mjs --input question.wav
```

This sample always creates two fresh agents in the same project and ignores `AGENT_NAME`:
an English-teacher **prompt agent** with plain-text output and a `[commentary]`/`[thinking]`
tagged-text contract, then a **GPT Live voice agent** with `store: true` pinned to the prompt
agent's exact returned version:

```json
{
  "delegation": {
    "type": "foundry_managed_agent",
    "agent_name": "<created-prompt-agent>",
    "agent_version": "<returned-prompt-version>"
  }
}
```

Foundry executes the prompt agent and forwards accepted guidance; the client only streams
audio and displays events. In the output:

- `session.delegation.created` with `target: "foundry_managed_agent"` reports Foundry's
  ownership; it is not a request for the client to run the prompt agent. Native `client` or
  `responses` targets are rejected, and no fallback executor is started.
- `response.event` lifecycle events, correlated by `delegation_id`, show the prompt agent's
  progress. Its raw output text is not printed: only guidance Foundry validates reaches GPT Live.
- `session.commentary.appended` / `session.thinking.appended` mark when Foundry forwards
  accepted guidance to GPT Live. The service no longer sends `session.managed_delegation.*`
  events.

Add `--create-only` to create and keep both agents without a recording or Live session.
Both agents are kept by default; add `--auto-delete` to delete only this run's agents on
exit, voice agent first. It also cleans up the prompt agent if voice-agent creation fails.
`response_delegation.mjs` can reconnect using `AGENT_NAME=<created-voice-agent>`.

## Differences from the Python samples

- Audio comes from a WAV recording and the reply can be saved to WAV, instead of a live
  microphone and speaker.
- Transcripts and delegation status print to the console instead of scrollable panes.
- There is no MCP calculator / local function variant.
- The managed sample reports Foundry's `response.event` and `session.commentary.appended`
  events, matching what the service sends today.

## Tests

Run the offline tests (no Azure resources, recordings, or audio devices). They drive the
real Projects SDK client: agent calls go to an in-memory HTTP client, and the Live client
talks to a scripted WebSocket transport.

```powershell
npm test
```
