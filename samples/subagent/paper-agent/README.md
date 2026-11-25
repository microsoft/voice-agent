---
ai-usage: ai-assisted
---

# Paper agent

A voice frontend handles greetings, thanks, acknowledgements, and chitchat
itself, and delegates **all academic-paper work** to a prompt-based research
specialist in the same Foundry project. The specialist uses the built-in web
search tool, prefers canonical arXiv sources where available, and supports
discovery, discussion, comparisons, and contextual follow-ups across disciplines.
It is not restricted to TTS or AI papers.

This follows the [basic prompt subagent](../voice_subagent_prompt_basic/README.md)
SDK pattern and reuses the [microphone client](../client/README.md). The requested
folder name `paper-agent` is an exception to the sample underscore convention.
There is no hosted application, custom search server, or local keyword router.
"Local" routing here means the voice frontend answers without invoking the
specialist, **not** offline/on-device inference.

## Prerequisites

- Python 3.10+ and Azure CLI authenticated with `az login`, or another identity
  supported by `DefaultAzureCredential`.
- Your own **non-production** Foundry project with voice agents and delegate
  subagents available in its region. The identity needs permission to create,
  run, and delete agents (for example, the Foundry User role).
- Access to a supported managed realtime voice model such as `gpt-realtime`,
  Azure Speech input transcription, and the configured Azure standard voice.
  Model/voice availability and quota depend on your resource and region.
- An existing text-model deployment that supports prompt agents and web search
  (for example, `gpt-4.1` where supported). Use its **deployment name** in
  `SUBAGENT_MODEL_DEPLOYMENT`. Neither script deploys models or requests access.
- Direct [web search](https://learn.microsoft.com/azure/foundry/agents/how-to/tools/web-search)
  enabled by your organization. `WebSearchTool` on a prompt agent does not
  require a separate Bing project connection or toolbox. Review its current
  availability, billing, and data-processing terms; search queries may leave
  the Azure compliance boundary. Use public research questions, not secrets or
  confidential documents.
- A microphone, speakers/headphones, and the shared client's audio dependencies
  for the spoken test.

The scripts create only two uniquely named agents in the project you configure.
They do not modify existing agents, production resources, model deployments,
RBAC, or project settings. Each run creates a new pair and can incur charges.
The voice definition sets `store=True` for conversation inspection; use only
non-sensitive test conversations and review your project's retention policy.
Deleting agents is not a guarantee that stored traces or recordings are erased.

## 1. Configure

From `samples/subagent/paper-agent`, on Linux/macOS:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
```

On Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Replace the placeholders in `.env` with your own project endpoint and deployment
names. Do not commit `.env`; it is ignored. The scripts load the `.env` beside
the script, and existing environment variables take precedence. No resource IDs,
private endpoints, API keys, or personal data are supplied by this sample.

## 2. Preview and deploy the agents

```bash
python create_agents.py --dry-run
python create_agents.py
```

`--dry-run` serializes the actual SDK definitions without authenticating or
contacting Azure; it needs `SUBAGENT_MODEL_DEPLOYMENT` but not an endpoint.
It is a configuration check, not a service compatibility or routing test.

Creation uses `AIProjectClient(..., allow_preview=True)` and
`project.agents.create_version()`: the prompt specialist is created first, then
the voice frontend references its name in `VoiceAgentDelegateSubagentConfig`.
The specialist has `WebSearchTool`; the frontend has no search tool of its own.

Keep the printed agent names and cleanup command. If creation fails partway,
the error propagates and the printed command lets you explicitly remove any
agents created; there is no silent fallback to another model or search service.

`VoiceAgentSubagentResponsePolicy(immediate_ack=False)` disables the automatic
acknowledgement. Instead, the voice instructions request **one brief natural
acknowledgement before delegation**, followed by the tool invocation in the same
turn. This avoids combining prompt-driven and automatic acknowledgements.
No extra gap-filling or progress policy is configured. Exact speech and routing
remain model/service behavior, not a deterministic guarantee: verify them below.

## 3. Run the voice frontend

Install the shared [client environment](../client/README.md) separately, including
PortAudio where required. From this sample folder on Linux/macOS:

```bash
../client/.venv/bin/python ../client/voice_client.py \
  --project-endpoint "https://<resource>.services.ai.azure.com/api/projects/<project>" \
  --agent-name "<printed-voice-agent-name>"
```

On Windows PowerShell:

```powershell
..\client\.venv\Scripts\python.exe ..\client\voice_client.py --project-endpoint "https://<resource>.services.ai.azure.com/api/projects/<project>" --agent-name "<printed-voice-agent-name>"
```

Replace both placeholders with your configured endpoint and the printed voice
agent name. Use headphones, wait for the connected message, and speak. The client
uses the Projects SDK realtime connection with the saved PCM16 mono 24 kHz
configuration. Keep one connection open for follow-ups; press `Ctrl+C` to exit.

## 4. Verify actual routing over multiple turns

Do not infer routing from a convincing answer or from "Let me look into that."
The shared client prints `Subagent started: <name>` and
`Subagent completed: <name>` from `session.subagent.started/completed`.
Confirm the name is the printed paper specialist. A failed/aborted event is
**not** a successful paper response. Wait for each turn to finish before the next.

Run this sequence in a single session, substituting the actual papers returned:

| Turn | Say | Expected evidence |
| --- | --- | --- |
| 1 | "Hi! How are you?" | Brief frontend reply; no specialist event. |
| 2 | "Find two arXiv papers about exoplanet atmospheres and explain their main ideas." | One acknowledgement, specialist started/completed, grounded answer with identifiable papers. |
| 3 | "What are the limitations of the second one?" | Specialist events again; answer refers to the actual second paper without requiring the keyword "paper". |
| 4 | "Compare those two approaches." | Specialist events; comparison uses both prior papers. |
| 5 | "Thanks, that helps." | Local thanks; no specialist event. |
| 6 | "Thanks, now find a paper about medieval trade networks." | Specialist events despite the greeting-like prefix and different discipline; primary non-arXiv sources are acceptable. |
| 7 | "Tell me more about its evidence." | Specialist events; referent is the medieval-trade paper, not the exoplanet paper. |
| 8 | "Okay." | Standalone acknowledgement, no specialist event, provided no question/offer is pending. |
| 9 | "What can you help me with?" | Brief capability description; no specialist event. |

Also test "yes" when accepting an explicit offer to compare/explain a paper:
that is a paper request and should delegate, unlike a standalone acknowledgement.
In a fresh session, an unresolved "compare those" should reach the specialist
for clarification, not produce invented papers.

Record the expected versus observed route for each turn, whether its referent
was correct, and the number of audible acknowledgements. Repeat with paraphrases
and a new session. A missed delegation, an unnecessary delegation, duplicate
acknowledgements, or an acknowledgement without a subsequent invocation is a
failure to investigate in the saved agent instructions and project traces.
Do not report a routing accuracy percentage without retaining those observations.

For a discovery turn, inspect the specialist's run/trace in Foundry as well:
confirm a web-search call actually ran and inspect returned source URLs.
Lifecycle events prove delegation, **not** web-search execution, correct context
transfer, citation fidelity, or factual correctness. The microphone client prints
speech transcripts, not a complete citation/annotation viewer; open the specialist
output or trace to inspect links rather than treating spoken attribution as proof.

### Recency limitation: "latest" and "last week"

A prior live prototype test produced misdated articles on date-restricted
discovery **even with web search**. This sample does not implement a deterministic
publication-date verifier, and its prompts do not fix that limitation reliably.
Neither search ranking nor a plausible date is proof that a paper is new.

Test "Find papers from last week about exoplanet atmospheres," establish explicit
calendar boundaries (supply dates if asked), and inspect every cited primary
source yourself. On arXiv, check submission history and distinguish v1 submission
from later revisions; elsewhere distinguish publication and online-posting dates
from crawl/index dates. Record unverified or out-of-window results as failures of
the date filter, even when delegation and web search succeeded. The assistant
should qualify uncertainty or return no verified matches instead of inventing
dates. Do not use this sample as a reliable latest-paper feed or exhaustive
literature review. Broader coverage, full-text access, and citation preservation
through the voice layer are also not guaranteed.

## 5. Delete the agents

From this folder, with the same project configured, run the command printed
during creation:

```bash
python delete_agents.py --voice-agent-name "<printed-voice-agent-name>" --subagent-name "<printed-subagent-name>"
```

This deletes the named agents and their versions, voice frontend first. Only
pass names created by this sample that you no longer need. Missing agents are
reported as already deleted; authorization and other errors propagate.

## Offline checks

With this sample's dependencies installed, run from the repository root:

```bash
python -m unittest discover -s tests -p "test_paper_agent.py" -v
```

These checks use released SDK models, with mocked Azure calls for lifecycle
checks. They cover serialized search/delegation configuration, dry-run isolation,
and creation/cleanup behavior. They do **not** measure live routing accuracy,
acknowledgement delivery, search quality, or recency correctness. No live Azure
deployment is required for these checks; use the manual sequence above in your
own non-production project for that evidence.
