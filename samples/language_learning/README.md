# Language-learning Voice Agent with pronunciation feedback

Have a spoken conversation with a patient language coach, then practice
specified sentences. **Every practice attempt calls Azure Speech Pronunciation
Assessment as a client-executed Voice Agent function tool.** The coach explains
the returned sentence scores and word errors; it does not guess pronunciation
from a transcript.

The default lesson practices US English. Supply your own sentences with repeated
`--sentence` arguments. **Speak naturally: there are no push-to-talk buttons or
practice commands.** During conversation the coach asks you to read a sentence,
waits for your attempt, and gives feedback. You can also say, "Let's practice
pronunciation" or "Can I try that sentence again?" Ordinary conversation can help
with vocabulary and grammar, but it is not pronunciation-scored.

## How it works

```text
Continuous microphone: mono PCM at 24 kHz
  |
  +--> Foundry Voice Agent: conversation and spoken feedback
  |       |
  |       +--> prepare_practice(sentence_number)
  |       |      +--> "Please read this sentence aloud: ..."
  |       |
  |       +--> Learner's next VAD-delimited turn
  |              +--> assess_pronunciation() function call
  |                |
  +----------------+--> Python client binds THIS recording + reference sentence
                           |
                           +--> Resample to 16 kHz WAV
                           +--> Azure Speech Pronunciation Assessment REST API
                           |
                           +--> Scores and word errors as function_call_output
                                      |
                                      +--> Voice Agent explains the feedback
```

The coach calls `prepare_practice` to select a numbered sentence from the
configured lesson before asking you to read it. The Python client binds the
next spoken turn to that reference. Server voice activity detection (VAD)
supplies the speech item's ID and audio start/end timestamps; the client slices
the matching PCM from a bounded in-memory audio history. It never uses the
transcript as the assessment input or submits the whole conversation.

VAD detects turns automatically, but automatic response creation is disabled.
The client requests normal conversational responses for chat and forces the
assessment function for a bound practice turn. Completed function calls are
executed once, then their output is submitted before requesting spoken feedback.
Assessment responses use `tool_choice="required"` with a one-tool allowlist
containing only `assess_pronunciation`; named function choice did not reliably
produce a function call in the live `gpt-realtime` check.
The model cannot replace the practice audio or reference through tool arguments.
After feedback the session returns to ordinary conversation. A spoken retry
request leads the coach to prepare the same sentence for a new attempt.

This is a standalone terminal sample, not an MCP server or a portal Template.
The function executes in this Python process. An agent created here will not
have pronunciation assessment available if used from a different client that
does not implement the function.

## Prerequisites

- Python 3.11+ and an Azure Foundry project with Voice Agent access and permission
  to create and enable agents. The requested model must be available in your
  project; the sample does not substitute another model.
- Azure CLI sign-in (`az login`) or another `DefaultAzureCredential` identity.
- An Azure Speech or Speech-capable Azure AI Services resource with a custom-domain
  endpoint and resource key. It can share an account with Foundry, but Foundry's
  project endpoint is **not** the Speech assessment endpoint.
- A microphone and speakers/headset for interactive mode. Use a headset to avoid
  recording the coach's voice. PyAudio requires PortAudio; on Ubuntu/WSL install
  `portaudio19-dev` and Python development headers if a wheel is unavailable.
  Your runtime must have access to an input audio device.

The standalone sample supports native Windows PowerShell; it does not use the
repository's Linux-only portal/MCP lifecycle scripts. File mode with
`--no-playback` requires no audio device.

## Set up

From this sample directory on Windows:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
az login
```

On Linux/macOS:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
test -f .env || cp .env.example .env
az login
```

Edit `.env` to reference **your** Foundry project and Speech resource:

```dotenv
AZURE_VOICE_AGENTS_ENDPOINT=https://<account>.services.ai.azure.com/api/projects/<project>
AZURE_VOICE_AGENTS_MODEL=gpt-realtime
AZURE_VOICE_AGENTS_VOICE=en-US-AvaNeural
AZURE_CREDENTIAL_MODE=cli
AZURE_SPEECH_ENDPOINT=https://<speech-resource>.cognitiveservices.azure.com
AZURE_SPEECH_KEY=<your-speech-resource-key>
```

Only this sample's `.env` is loaded; process environment variables take precedence.
`AZURE_CREDENTIAL_MODE=cli` or `--credential-mode cli` pins Foundry authentication
to the identity selected by `az login`. The default mode uses `DefaultAzureCredential`.
Public Azure cloud endpoints are supported. Sovereign clouds, private endpoints,
and keyless Speech authentication need explicit adaptations. Never commit `.env`,
resource keys, learner recordings, or assessment transcripts.

## Run a lesson

```powershell
.\.venv\Scripts\python.exe language_learning.py `
  --sentence "Could you recommend a good restaurant near the station?" `
  --sentence "I would like to improve my English pronunciation."
```

Linux/macOS equivalent:

```bash
.venv/bin/python language_learning.py \
  --sentence "Could you recommend a good restaurant near the station?" \
  --sentence "I would like to improve my English pronunciation."
```

Without `--sentence`, three built-in sentences are used.

The coach greets you and asks about your day or learning goals. After a few chat
turns, or when you ask to practice, it chooses a sentence and asks you to read it.
The exact timing is model-directed, not a fixed turn counter. Read only that
sentence on your next turn and wait for feedback. The terminal also displays the
reference so you can read it rather than memorize the coach's voice.

Pause to finish a turn. The default silence threshold is **2 seconds**; use
`--pause-ms 3000` for more thinking time (allowed range 500–5000 ms). A pause
longer than the threshold ends the attempt, so read one sentence continuously.
VAD can split a hesitant sentence; an incomplete attempt is assessed as such,
not silently stitched to a later chat turn. Ask to retry if that happens.

Speak over a spoken reply to interrupt playback. During an assessment request,
wait for the coach rather than starting another attempt. Use `--no-playback` for
printed feedback only, and **Ctrl-C** to end the lesson. Every assessment slice
must be **0.1 to 30 seconds**, including VAD padding/silence. An overlong or
missing slice produces an explicit unsuccessful tool result, not a truncated or
unrelated recording.

The terminal prints the actual tool result before the coach's response:

```text
Coach: Please read this sentence aloud: I would like to improve my English pronunciation.
You: I would like to improve my English pronunciation.
Tool result:
{
  "ok": true,
  "reference_text": "...",
  "language": "en-US",
  "recognized_text": "...",
  "score_scale": "0-100",
  "scores": {
    "pronunciation": ...,
    "accuracy": ...,
    "fluency": ...,
    "completeness": ...
  },
  "words": [...],
  "practice_words": [...]
}
Coach: <spoken and printed feedback based on those results>
```

The placeholders above describe the output shape, **not measured results**.
Word entries include `word`, `accuracy`, and `error_type` (such as `Omission`,
`Insertion`, or `Mispronunciation`). `practice_words` selects service-reported
errors and words with accuracy below 80; that threshold is a sample teaching
heuristic, not a Speech service proficiency boundary.

## Use a recorded sentence

Provide an uncompressed mono, 16-bit PCM, **24 kHz** WAV and exactly one reference:

```powershell
.\.venv\Scripts\python.exe language_learning.py `
  --audio-file C:\audio\practice.wav `
  --sentence "I would like to improve my English pronunciation." `
  --no-playback
```

This disables VAD for file input, runs the assessment function once, and exits.
A failed assessment
exits nonzero after notifying the coach. WAV files are validated before creating
the agent. If needed, convert a recording first:

```text
ffmpeg -i recording.m4a -ac 1 -ar 24000 -c:a pcm_s16le practice.wav
```

`--language` selects a pronunciation-assessment locale (default `en-US`). Check
[supported locales](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=pronunciation-assessment),
provide matching reference sentences, and set a suitable output voice in `.env`.
There is no automatic language detection or fallback. `--prosody` explicitly
opts in to prosody assessment for `en-US`; check its availability and pricing.
Prosody scores are never invented if omitted by the service.

## Failures, costs, and privacy

- Foundry and Speech requests incur their respective Azure charges. The REST
  assessment uses the Speech-capable resource's key, quota, and language availability.
- NoMatch, invalid/missing score data, authentication failures, rate limits,
  and network timeouts produce an explicit unsuccessful tool result. The coach
  is instructed to say assessment is unavailable and request a retry, not assign
  zero scores or fabricate an evaluation. No assessment requests are automatically
  retried, avoiding surprise duplicate billing.
- Each run creates and enables a uniquely named agent. It is **retained** after
  exit; delete it in Foundry when no longer needed. No existing agent is modified.
- `store=False` disables Foundry conversation persistence for this sample.
  Audio is still sent to Azure Foundry and Speech for processing. The sample
  does not write recordings or assessment files, but prints learner text and
  results to the terminal. Microphone audio history is capped at approximately
  120 seconds in memory and cleared when the sample exits. Handle terminal history
  and Azure resource telemetry
  according to your privacy requirements.
- Scores are practice feedback, not a language-proficiency certificate. Noise,
  audio quality, locale selection, and reference-text mismatch affect results.
- A session is capped at 1000 completed tool calls. Restart the sample for a
  new lesson if that limit is reached.

Known speech-rendering issues and follow-up work are tracked in [TODO.md](TODO.md).

## Validate

Offline tests use controlled audio and service boundaries, not a real Speech
resource or microphone:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s . -p "test_*.py" -v
```

On Linux/macOS use `.venv/bin/python` instead. The tests cover resampling/WAV
format and duration limits, the real HTTP request contract, score/error parsing,
VAD item/timestamp binding, conversation-to-practice transitions, spoken retries,
barge-in, and SDK tool-output framing.

For a live acceptance check, run the interactive two-sentence lesson above.
Chat with the coach, ask to practice both sentences, and ask to retry the first.
Verify the printed reference matches each recording, every practice
produces one assessment result and spoken feedback, and chat produces no
assessment. Deliberately omit a word in one attempt and inspect the word-level
result. Compare with the raw tool scores rather than trusting the coach's
paraphrase. File mode provides a reproducible end-to-end check.

### Live service validation

On October 5, 2026, `gpt-realtime` in an existing Central US Foundry project
passed both WAV-file assessment and the hands-free conversational workflow.
Locally synthesized speech was streamed through the real voice endpoint:
conversation, `prepare_practice`, VAD-delimited reading, pronunciation tool
execution, spoken feedback generation, a spoken retry request, and a second
assessment. The Speech REST API returned sentence and word scores for both
attempts; the client used the matching VAD audio slice rather than chat audio.
The first hands-free attempt returned pronunciation **95.8**, accuracy **93**,
fluency **100**, and completeness **100**.

These are synthetic-audio integration results, not learner benchmarks or proof
of microphone/playback quality. Physical microphone input, speaker playback,
and live barge-in were not exercised; those remain part of the operator's
interactive acceptance check. Keys were kept in process memory, not written
to the repository.

## References

- [Pronunciation Assessment](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment)
- [Short-audio REST API: request headers, 16 kHz WAV, 30-second assessment limit, and result schema](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-speech-to-text-short)
- [Existing client-executed function sample](../voice_agent_with_local_function.py)

The REST API is used here to make the bounded recording and function-tool request
explicit without a native Speech SDK dependency. For continuous assessment or
recordings longer than 30 seconds, use the Speech SDK and its continuous mode
rather than increasing this sample's limit.
