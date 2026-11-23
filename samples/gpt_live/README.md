# Foundry GPT Live samples

English-teacher GPT Live voice agents in an existing Foundry project, built with the
preview Azure AI Projects SDKs. Both versions create or reuse the agents, stream microphone
audio through a GPT Live session, and show the teacher's and your transcripts beside a
Delegation view. Both cover all three delegation types: Responses, a versioned Foundry-managed
prompt agent, and client delegation, where the app answers GPT Live itself. Every agent has a
template greeting and structured inputs (the learner's name and English level) that each
session fills in. With Responses or Foundry-managed delegation you can also type a message
instead of speaking; the backend answers it and GPT Live speaks the reply.

| Folder | Sample |
| --- | --- |
| [`python/`](python/README.md) | Terminal samples with the Python SDK: Responses delegation, managed prompt-agent delegation, a managed prompt agent with MCP and local function tools, and client delegation. |
| [`js/`](js/README.md) | A simple browser sample with the JavaScript SDK: the page connects to GPT Live directly with your microphone, and a local Node.js server creates the agents and gives the page an access token from `az login`. Its modes cover Responses, managed prompt-agent (with the MCP calculator and local date/time function), and client delegation. |

Both samples install the published Projects SDK 2.11.0 or later: `azure-ai-projects` from
PyPI and `@azure/ai-projects` from npm.

## Shared settings

Both samples read `samples/gpt_live/.env`. From the repository root, in PowerShell:

```powershell
az login
if (-not (Test-Path -LiteralPath samples\gpt_live\.env)) { Copy-Item samples\gpt_live\.env.example samples\gpt_live\.env }
```

Set `FOUNDRY_PROJECT_ENDPOINT` to a **Central US** Foundry project with managed
GPT Live availability. New voice agents use `model_type: managed` and
`model: gpt-live-1`; no GPT Live deployment or `GPT_LIVE_DEPLOYMENT` setting is
required. For Responses or managed prompt-agent delegation, set
`RESPONSE_DELEGATION_DEPLOYMENT` to an existing text-model deployment in that
project. Client delegation needs no text deployment. Set `AGENT_NAME` to reuse an existing GPT Live agent in
the Responses-delegation samples; the managed prompt-agent samples always create fresh
agents. Authentication uses your `az login` account; no API keys are needed. Never commit
`.env`.

Direct Responses delegation also requires a backend supported by GPT Live in the
region. Central US currently reports `gpt-6.1-sol` and `gpt-6-luna`; an existing
`gpt-4.1` deployment is rejected for direct Responses delegation. To use another
text model, run the Foundry-managed prompt-agent mode instead.

For example, a project endpoint has the form
`https://YOUR-CENTRAL-US-RESOURCE.services.ai.azure.com/api/projects/YOUR-PROJECT`.
To use a self-deployed GPT Live model instead, set `GPT_LIVE_MODEL_TYPE=self_deployed`
and `GPT_LIVE_DEPLOYMENT` to its existing deployment name in the configured project.
All delegation modes support this choice in both languages. The default is
`GPT_LIVE_MODEL_TYPE=managed`, which ignores `GPT_LIVE_DEPLOYMENT` and uses
`gpt-live-1`. Self-deployed mode requires the deployment and regional availability
of your chosen model; it does not require managed GPT Live availability.

The hostname alone does not establish the region; check the resource's
location in Azure. The samples neither create resources nor change regions.
Existing agents retain their saved model type and deployment settings; only
self-deployed Live models and delegated text models need deployment lookup.
