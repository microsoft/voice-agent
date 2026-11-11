# Turn detection: speech start and end-of-utterance detection

Create a voice agent that takes turns more like a person, then talk to it through the microphone and watch each turn decision. Two optional settings under `audio.input.turn_detection` make turn start and turn end detection more accurate:

- **Speech start detection** (`speech_start_detection`) decides whether caller speech takes the turn. Backchannels such as "mm-hm" or "yeah, that makes sense" don't interrupt the agent, while "wait" or "what?" do.
- **Text EOU based Decision** (`end_of_utterance_detection.model = "microsoft-decision-1"`) decides whether the caller has finished. A pause in the middle of an order number doesn't end the turn.

Both use the `microsoft-decision-1` model, which reads the caller's transcript together with what the agent just said. Both only change configuration; the events and the rest of the agent stay the same.

| File | What it does |
| --- | --- |
| [`create_turn_detection_agent.py`](create_turn_detection_agent.py) | Builds a parcel-tracking voice agent with both settings, creates an agent version, and reads back the saved turn detection configuration. |
| [`talk_to_turn_detection_agent.py`](talk_to_turn_detection_agent.py) | Connects with the realtime client, streams microphone audio, plays the response, and prints when the caller takes the turn and which speech was a backchannel. |
| [`template_variants.py`](template_variants.py) | Generates the turn detection variants of three portal Templates; see [Portal Templates with turn detection](#portal-templates-with-turn-detection). |

## Prerequisites

- Python 3.11 or later.
- Azure CLI signed in with `az login`.
- A Foundry project with access to voice-based agents and the `gpt-realtime` model, and permission to create agents in it. Both settings are rolling out by region; East US 2 EUAP has them now.
- A microphone and speakers or headphones. Use headphones so the agent's speech doesn't feed back into the microphone.

## 1. Install

From this folder:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

On Windows PowerShell, activate the environment with `.venv\Scripts\Activate.ps1`.

The client library doesn't have typed models for the two settings yet, so the sample passes `turn_detection` as JSON. PyAudio builds against PortAudio. If its installation fails, install PortAudio first, for example `sudo apt-get install portaudio19-dev` on Ubuntu or `brew install portaudio` on macOS, and then rerun the command.

## 2. Set environment variables

Use a new agent name so that the sample doesn't create a version of an agent used by another application. Find the endpoint on the **Overview** page of your project in the Foundry portal.

```bash
export FOUNDRY_PROJECT_ENDPOINT="https://<account>.services.ai.azure.com/api/projects/<project>"
export FOUNDRY_VOICE_AGENT_NAME="turn-detection-voice-agent"
```

In PowerShell:

```powershell
$env:FOUNDRY_PROJECT_ENDPOINT = "https://<account>.services.ai.azure.com/api/projects/<project>"
$env:FOUNDRY_VOICE_AGENT_NAME = "turn-detection-voice-agent"
```

## 3. Create the agent version

```bash
python create_turn_detection_agent.py
```

The turn detection configuration in the script:

```json
"turn_detection": {
  "type": "azure_semantic_vad_multilingual",
  "speech_start_detection": {
    "while_assistant_speaking": {
      "acknowledgement_phrases": ["mm-hm", "uh-huh", "okay", "yeah", "right", "got it"],
      "interruption_phrases": ["stop", "wait", "hold on"],
      "turn_taking_classifier": { "threshold": 0.5 },
      "num_words": 3
    },
    "while_assistant_not_speaking": { "num_words": 1 }
  },
  "end_of_utterance_detection": {
    "model": "microsoft-decision-1",
    "threshold_level": "high",
    "timeout_ms": 1500
  }
}
```

- While the agent speaks, an exact acknowledgement phrase never takes the turn and speech containing an interruption phrase always does. For other speech, `turn_taking_classifier` asks `microsoft-decision-1` whether it takes the turn, given what the caller has heard. A word count can't tell "yeah, that makes sense" (a backchannel) from "what?" (a turn); the model can. Higher `threshold` values admit fewer turns. `num_words` decides only when the model gives no verdict.
- The classifier is off while the agent is silent, where `num_words: 1` lets any word take the turn. Turning it on there adds a model call, typically a few hundred milliseconds, before every turn.
- When the caller pauses, `microsoft-decision-1` judges whether the turn is finished. `threshold_level` `high` waits more often; `timeout_ms` is how long it waits for more speech before the agent answers anyway.
- Speech start detection needs a streaming transcription model, so the agent uses `azure-speech-streaming`.

Expected output (the version number increases with each run):

```output
Created 'turn-detection-voice-agent', version 1
turn_detection.type: azure_semantic_vad_multilingual
speech_start_detection while speaking: turn_taking_classifier threshold=0.5, num_words=3
end_of_utterance_detection: model=microsoft-decision-1, threshold_level=high, timeout_ms=1500
```

## 4. Talk to the agent

```bash
python talk_to_turn_detection_agent.py
```

Try the following conversation. Response wording varies.

| Say to the agent | Expected result |
| --- | --- |
| "Hi, I want to know where my parcel is." | The agent asks for the 8-digit order number. |
| "My order number is 4 5 7 2", pause for about a second, then "9 1 3 8". | The agent waits through the pause and answers once, reading back all eight digits. |
| While the agent explains the delivery status, say "mm-hm" or "yeah, that makes sense". | The client prints `Caller (backchannel, agent keeps talking): ...` and the agent finishes its answer. |
| While the agent is talking, say "What?" | The client prints `[caller took the turn]`, and the agent stops to answer. |
| While the agent is talking, say "Wait, stop." | The client prints `[caller took the turn]` and the agent stops. |

Press `Ctrl+C` to disconnect.

Speech that doesn't take the turn gets no response and produces no `input_audio_buffer.speech_started` or `speech_stopped` event. The client still receives its transcript with `"backchannel": true`, and the transcript stays in the conversation history.

## Portal Templates with turn detection

Three portal Templates come with a turn detection variant next to the original, so you can load both and compare the same workflow:

| Template | Base example | What the variant shows |
| --- | --- | --- |
| Example 1: Finance with Handoff - Turn Detection (Hindi, hi-IN) | [example1_finance_with_handoff_realtime_hi_in](../example1_finance_with_handoff_realtime_hi_in/README.md) | "जी" or "हाँ जी" while the agent reads the loan offer or the charges doesn't interrupt it; telling a child to turn down the TV is ignored; a pause in the middle of a date of birth doesn't end the turn. |
| Example 10: Collections and Payment Recovery - Turn Detection | [example10_collections_payment_recovery_agent](../example10_collections_payment_recovery_agent/README.md) | "Okay" while the agent reads the balance and payment options doesn't interrupt it; speech to someone at home is ignored; a pause while reading the last four digits or a date of birth doesn't end the turn. |
| Example 32: Technical Support - Turn Detection | [example32_technical_support_agent](../example32_technical_support_agent/README.md) | "Okay" while the agent reads a troubleshooting step doesn't interrupt it; a request to a coworker is ignored; a pause in the middle of an email address doesn't end the turn. |

Each variant is `agent.turn_detection.json` in the base example's directory, generated by [`template_variants.py`](template_variants.py) from that directory's `agent.json`. The workflow, prompts, tools, model and voice are the base example's. Only the audio input changes, and the shared instructions gain a note on paused turns:

- `turn_detection`: the base settings stay as they are (thresholds, padding, silence duration and the idle timeout); the variant adds `speech_start_detection` with phrase lists for the caller's language and a `turn_taking_classifier` whose `criteria` describe this call's backchannels and side speakers, and `end_of_utterance_detection` with `microsoft-decision-1`, whose `instructions` say what a finished answer looks like in this workflow (for example, a date of birth needs a day and a month).
- `transcription`: `azure-speech-streaming` with an explicit `language`. Both settings need a streaming recognizer on a realtime model, and streaming Azure Speech needs a language.
- `noise_reduction`: `azure_personal_noise_suppression`, which learns the caller's voice and suppresses other voices before recognition.
- The shared instructions tell the model that a turn interrupted by a pause can arrive as several consecutive caller messages. On a realtime model each pause commits a separate user item, and the answer waits until the caller has finished.

The turn detection settings apply to the whole session; handoff stages can't set their own. Write `criteria` and `instructions` to cover every stage of the workflow.

After you change a base example's `agent.json`, regenerate the variants:

```bash
python samples/turn_detection/template_variants.py
```

`python samples/turn_detection/template_variants.py --check` fails when a committed variant is out of date; the portal tests run the same check.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Create or connect fails with `400` about `speech_start_detection` | Use `azure-speech-streaming` or `mai-transcribe-2-streaming` transcription and an Azure semantic VAD type, and don't enable `keyword_interrupt`. |
| Connect fails with `speech_start_detection_not_supported` | The region doesn't have the turn-taking classifier yet. Remove `turn_taking_classifier` to use only the phrase lists and `num_words`. |
| Connect fails with `invalid_eou_config` | The region doesn't have `microsoft-decision-1` yet, or the transcription model isn't supported. |
| The agent answers in the middle of the order number | Pause for less than `timeout_ms`, or raise `timeout_ms`. |
| Create fails with a permissions error for an identity you don't expect | `DefaultAzureCredential` picked another credential, such as a virtual machine's managed identity. Set `AZURE_TOKEN_CREDENTIALS=AzureCliCredential` to use your Azure CLI sign-in. |

## Clean up

The agent remains in your project after you disconnect. Delete it in the Foundry portal when you no longer need it.
