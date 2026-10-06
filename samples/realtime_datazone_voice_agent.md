# Voice-first realtime samples: US Data Zone, Japan East, and Central India

This sample publishes a **`kind: voice`** Foundry Agent using the exact managed
model **`gpt-realtime-2.1-datazone`**, then opens a hands-free microphone session.
It uses 24 kHz mono PCM audio, automatic voice activity detection, interruption,
user/assistant transcripts, and the American English Azure Speech HD voice
`en-US-Ava:DragonHDLatestNeural`.
It reuses the basic sample's microphone capture and playback implementation.
An explicit `--model azure-realtime` option uses Azure Realtime with its required
native `ava` voice instead; the default remains GPT Realtime 2.1 Data Zone.
An explicit `--model gpt-realtime` option targets an eligible Central India
Project using the Standard (regional) model listed for that region.

| Model | Output voice | Voice type |
| --- | --- | --- |
| `gpt-realtime-2.1-datazone` | `en-US-Ava:DragonHDLatestNeural` | `azure-standard` (Azure Speech HD) |
| `azure-realtime` | `ava` | `azure-realtime-native` |
| `gpt-realtime` | `en-IN-Diya:DragonHDLatestNeural` | `azure-standard` (Azure Speech HD) |

These voices are set when creating an Agent. Existing Agents retain their stored
voice settings; run without `--agent-name` to create an Agent with the new defaults.

## Select the model for your Project region

| Foundry Project region | Model | GPU inference routing |
| --- | --- | --- |
| East US 2 (`eastus2`) | `gpt-realtime-2.1-datazone` | US GPUs within the US data zone |
| Japan East (`japaneast`) | `azure-realtime` | Japan East GPUs |
| Central India (`centralindia`) | `gpt-realtime` | Central India, using the Standard (regional) processing listed for this exact model. |

**For the East US 2 Project, select the Data Zone model: inference stays in
the US. For a Japan East Foundry Project, select Azure Realtime with confirmed
Japan East GPU routing.**

The Japan East GPU-routing statement is based on the Project-specific service
team confirmation supplied for this sample, not inferred from the endpoint
hostname or the public region table. Do not generalize it to other Japan-region
Projects without equivalent confirmation.

## US-region prerequisite

For customers who must use **Data Zone or Standard (regional)** rather than
Global processing, select a supported region and model/deployment option from
[Supported regions for Azure Speech - Voice Live](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/regions?tabs=voice-live).
The default selects Data Zone with `gpt-realtime-2.1-datazone`; it does not
demonstrate Standard (regional) or fall back to Global. 

Use a Foundry Project under a **US-region** account whose subscription and region
are enabled for Voice Agents and this exact managed model. A US locale in the
voice name does not select a deployment region. The Project's parent account
determines the resource region; the endpoint hostname does not encode it.

Confirm the account location before running:

```powershell
az cognitiveservices account show --resource-group <resource-group> --name <account> --query location --output tsv
```

For example, use an East US 2 Project **only if the service owner confirms
eligibility for that Project and model**. This sample does not provision an
account or establish regional eligibility. General Azure OpenAI model
availability does not imply Voice Agent managed-model availability. See
[subscription and region setup](../docs/01_setup_subscription.md).

The sample does not create a customer-managed model deployment, change to
self-deployed mode, or substitute another model if the requested one is
unsupported. Creation errors are surfaced.

## Run East US 2 Data Zone in PowerShell

Use your own Foundry resource in East US 2 (`eastus2`). Replace
`<eastus2-resource>` and `<project-name>` below with that resource's name and
your Project name. The resource root
`https://<eastus2-resource>.services.ai.azure.com/` alone is not a Project
endpoint.

From the repository root, use the virtual environment's Python directly
(no activation script is required):

```powershell
if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
    python -m venv .venv
}
.\.venv\Scripts\python.exe -m pip install -r samples\requirements.txt
az login
$env:AZURE_VOICE_AGENTS_ENDPOINT = "https://<eastus2-resource>.services.ai.azure.com/api/projects/<project-name>"

# Create, enable, and verify the stored definition without opening audio devices.
.\.venv\Scripts\python.exe samples\realtime_datazone_voice_agent.py --create-only

# Reuse the printed agent name and start talking.
.\.venv\Scripts\python.exe samples\realtime_datazone_voice_agent.py --agent-name <printed-agent-name>
```

Alternatively, omit `--create-only` and `--agent-name` to create an agent and talk
in one command. Use a headset; pause to receive a reply and talk over playback to
interrupt. Press Ctrl+C to end the session. The sample prints the persisted
conversation ID and artifact download command when returned by the service.

`samples.env` may supply `AZURE_VOICE_AGENTS_ENDPOINT`; process environment
values take precedence. Unlike the general basic sample, this sample deliberately
ignores the shared model, model-type, voice, and agent-name environment settings.
It prints the stored system prompt length in **characters**, not tokenizer tokens.

## Azure Realtime in Japan East

**This Azure Realtime sample targets the Japan East (`japaneast`) resource region.**
The script prints that target explicitly; it does not automatically verify
the account location.

The [Voice Live region table](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/regions?tabs=voice-live)
lists **`azure-realtime` in `japaneast` as Global Standard**, with Agent support.
For a **Japan East Foundry Project**, select Azure Realtime and confirm with the
service team that inference runs on **Japan East GPUs**. Each Project needs
its own routing confirmation; hosting
an account in Japan East alone does not establish GPU placement.
The same table currently lists `gpt-4o` as Standard in Japan East,
but that is a different model and is not an automatic fallback in this sample.

Use a separate, eligible Foundry Project under a Japan East account. Verify its
parent account location with the `az cognitiveservices account show` command
above; it must return `japaneast`. The script cannot infer a region from the
Project URL.

After the same dependency setup and sign-in, replace `<japaneast-resource>`
and `<project-name>` with your own Japan East resource and Project names:

```powershell
$env:AZURE_VOICE_AGENTS_ENDPOINT = "https://<japaneast-resource>.services.ai.azure.com/api/projects/<project-name>"
.\.venv\Scripts\python.exe samples\realtime_datazone_voice_agent.py --model azure-realtime --create-only
.\.venv\Scripts\python.exe samples\realtime_datazone_voice_agent.py --model azure-realtime --agent-name <printed-agent-name>
```

The sample publishes `model_type: managed`, `model: azure-realtime`,
and `audio.output` fields `voice: "ava"` and `voice_type: "azure-realtime-native"`.
Readback validation accepts both these flat fields and the equivalent
`voice: {"type": "azure-realtime-native", "name": "ava"}` object, including
additional voice properties returned by the service.
The native voice is English; resource region and conversation language are
independent. Azure standard TTS voices are not substituted for native voices.
See [Azure Realtime voice configuration](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live-how-to#azure-realtime-model).
Always pass `--model azure-realtime` when reusing this agent, since the default
model is Data Zone and mismatched agents are rejected.

## GPT Realtime in Central India

Select **`gpt-realtime`** for a **Central India (`centralindia`) Project**.
The [Voice Live region table](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/regions?tabs=voice-live)
lists this exact model as **Standard**, for regional inference in Central India.
Do not substitute `gpt-realtime-2.1`: the table lists that model as
Global Standard in Central India.

**Prerequisite:** the public table currently does not list Agent support for
Central India. This sample requires a voice-first Foundry Agent, so have the
service team confirm eligibility for your subscription, Project, and model.
Direct Voice Live model availability alone does not establish Voice Agent
availability. Publication errors are surfaced without fallback to another
region, model, or Agent type.

Verify the account location returns `centralindia`, then run from the repository
root after the dependency setup and sign-in above. Replace the account and
Project placeholders with the actual Central India Project endpoint:

```powershell
az cognitiveservices account show --resource-group "<resource-group>" --name "<centralindia-account>" --query location --output tsv
$env:AZURE_VOICE_AGENTS_ENDPOINT = "https://<centralindia-account>.services.ai.azure.com/api/projects/<project>"
.\.venv\Scripts\python.exe samples\realtime_datazone_voice_agent.py --model gpt-realtime --create-only
.\.venv\Scripts\python.exe samples\realtime_datazone_voice_agent.py --model gpt-realtime --agent-name <printed-agent-name>
```

The sample uses the managed `gpt-realtime` model and Azure standard
`en-IN-Diya:DragonHDLatestNeural` HD voice. Resource region and conversation
language are independent.
Always repeat `--model gpt-realtime` when reusing this agent.

The identity needs Agent data-plane permissions. The agent is retained and
`store: true` enables persisted conversations/audio; use nonsensitive test speech.
An existing agent must match the model and microphone audio contract or the
sample refuses to connect. `--create-only` verifies publication, not live model
inference. This is a terminal sample, not a registered portal template.
