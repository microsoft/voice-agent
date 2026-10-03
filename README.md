# Voice Agent in Foundry Agent Service - Resource
[Voice Agent in Foundry Agent Service](https://learn.microsoft.com/en-us/azure/foundry/agents/quickstarts/prompt-voice-agent?pivots=portal) offers below key values to customers:


> Build and launch an enterprise-ready voice agent in under two minutes. Choose speech-to-speech or cascaded pipelines powered by OpenAI, Microsoft AI, and Azure real-time models.  Extend your agent with Foundry tools, monitor and measure its performance, and connect inbound and outbound calls through Teams and Twilio. Create engaging conversations with voices optimized for call centers and lifelike avatars.

This repository is the official community hub for Voice Agent in Foundry Agent Service. Here you'll find:

🐛 Report Issues — File bugs, feature requests, and feedback via [GitHub Issues](https://github.com/microsoft/voice-agent/issues)

📚 Resources — Curated links to docs, videos, blogs, and community content for Voice Agent

🧪 Samples — Hands-on samples and extended solutions

# Voice Agent and Voice Live

[Voice Live](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live) is the foundation for real-time voice interaction, and Voice Agent builds on that foundation to deliver complete voice-first agents. Voice Live handles the real-time voice experience, while Voice Agent adds the intelligence, tools, knowledge, and orchestration required to build end-to-end agentic applications.

For most customers building voice-first agents, we recommend starting with Voice Agent. Voice Agent provides the more complete, integrated experience for building and operating an agent, bringing together voice, reasoning, instructions, knowledge, tools, and orchestration. Voice Live is a better fit when customers already have their own agent stack and primarily need real-time voice capabilities with greater control over the voice application architecture.

## Quick Links

[Open the Foundry portal](https://ai.azure.com/) | [Open the new Foundry portal](https://ai.azure.com/nextgen)

In the Foundry portal, open your project, go to **Build > Agents**, select **Build an agent**, and choose **Voice** as the interaction mode.

- [Quickstart: Create a voice-based prompt agent](https://learn.microsoft.com/en-us/azure/foundry/agents/quickstarts/prompt-voice-agent?pivots=portal): Create a voice agent in the Foundry portal, customize its instructions, and test spoken conversations in the playground.
- [Use a hosted agent as the conversation engine](https://learn.microsoft.com/en-us/azure/foundry/how-to/voice-first-with-hosted-agent): Use a hosted agent for conversation logic and tools, while Voice Live handles speech, turn-taking, and interruptions.
- [Use a subagent in a voice-based agent](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/use-subagent-voice-first-agent): Delegate specialized requests to prompt or hosted subagents in the same Foundry project.

Voice Agent is now available in public preview. See the [voice agent documentation](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/voice-agent-pricing). Customers can start to build voice agent and get ready to production.

For questions and feedback, contact the Voice Agent team at [voiceagent@microsoft.com](mailto:voiceagent@microsoft.com).

Explore [Voice Agent in Foundry Agent Service](#voice-agent-examples) for voice agent guides, portal links, and runnable samples.

## Voice Agent Blogs

- 2026.09 [**Ship agents faster with expanded model choice, voice agents, and continuous optimization**](https://azure.microsoft.com/en-us/blog/ship-ai-agents-faster-with-new-capabilities-in-microsoft-foundry-expanded-model-choice-voice-agents-and-built-in-optimization/) — Overview of the latest Foundry Agents capabilities, including a Voice Agent video overview.
- 2026.09 [**Introducing voice agents in Microsoft Foundry**](https://aka.ms/VoicefirstagentsSept2026) — Voice Agent public preview announcement.

## Voice Agent Customer Stories

- [**Astra Tech brings Voice Live API in Azure AI Foundry to its fintech-first app**](https://www.microsoft.com/en/customers/story/25412-astra-tech-azure-ai-foundry) — Astra Tech uses Voice Live in **botim** for a multilingual voice assistant that helps users complete tasks such as international money transfers. The story reports **300,000 monthly active users and 100,000 daily active users**.
- [**Boosting patient satisfaction with healow Genie and Voice Live API in Azure AI Foundry**](https://www.microsoft.com/en/customers/story/25363-healow-azure-kubernetes-service) — The article describes a Voice Live pilot for **healow Genie**, covering appointment information, common questions, and voicemail callbacks. **Pilot:** It discusses anticipated benefits rather than measured improvements from a completed rollout.
- [**Kansai Television: AI Hachiemon**](https://www.microsoft.com/en-us/ailab/case-study/kansai-television) — Microsoft AI Co-Innovation case study. Kansai Television built a conversational version of its mascot, **Hachiemon**, using Voice Live and Azure AI Foundry. Azure AI Speech Custom Voice recreates the character's distinctive voice for entertainment and interactive experiences.

---

## Voice Agent examples

### Start here

This directory is the entry point for the Voice Agent portal, runnable samples,
the Finance reference workflow, and its shared MCP service. Detailed setup and
operation instructions live with the component that owns them; this file routes
users and coding agents to the correct entry point.

> [!IMPORTANT]
> **On Windows, use WSL2 for this repository.** Do not run the repository
> setup or runtime workflow from native PowerShell or Command Prompt, and do
> not use a checkout mounted under `/mnt/c/`. Start WSL2, clone the repository
> into the WSL Linux filesystem (for example, `~/src/voice-agent`),
> and run all repository commands from WSL. Use the Windows browser to open
> the resulting `localhost` UI and grant microphone permission.

The standalone [audio rewrite and translation sample](samples/audio_file_rewrite/README.md)
also supports native Windows PowerShell with Python 3.11+, without WSL.

For an unqualified request such as **"run the UI"** or **"start the portal"**,
use [`portal/`](portal/README.md). It is the general Voice Agent UI and runs on
`http://127.0.0.1:9527` by default. Do not start the Finance MCP stack unless
the request mentions Finance, Templates, or the shared MCP.

### Portal + local MCP quickstart

Use this path when the portal must publish or run the checked-in Templates.
It is the recommended end-to-end Linux/WSL workflow:

```bash
cd /path/to/voice-agent
az login
./scripts/setup-local-examples.sh \
   --project-endpoint "https://<account>.services.ai.azure.com/api/projects/<project>"
./scripts/login-devtunnel.sh
./scripts/setup-local-examples.sh --check
./scripts/manage-local-mcp-and-ui.sh restart
```

`login-devtunnel.sh` uses GitHub device-code authentication. Follow the printed
`https://github.com/login/device` prompt. Azure operations continue to use the
separate identity selected by `az login`.

Success requires `local_mcp_and_portal=ready`. Open
**http://localhost:18098**, then verify with:

```bash
./scripts/manage-local-mcp-and-ui.sh status
curl -fsS http://127.0.0.1:18003/healthz
curl -fsS http://127.0.0.1:18098/healthz
```

Port `9527` is only for a portal-only session without the managed local MCP
lifecycle. Do not run a second manual portal after this quickstart.

### Choose an entry point

| Goal | Start here | What it owns |
| --- | --- | --- |
| Run the general Voice Agent UI | [`portal/README.md`](portal/README.md) | Agent editor, YAML version editing, Templates, voice playground, and standalone WebRTC page |
| Run Python or .NET samples | [`samples/README.md`](samples/README.md) | Common Python setup, microphone samples, REST lifecycle, IQ, Toolbox, local functions, downloads, and the C# sample |
| Run the GPT Live terminal sample | [`samples/gpt_live/README.md`](samples/gpt_live/README.md) | Create or reuse a GPT Live agent, stream microphone audio with the OpenAI SDK, and view independently scrollable GPT Live, delegation, and user transcripts |
| Run the complete Finance workflow | [`docs/README.md`](docs/README.md) | Ordered subscription, MCP, sample, portal, and debugging guides |
| Work on or deploy the Finance MCP | [`shared_mcp/README.md`](shared_mcp/README.md) | Shared MCP image, Finance routes, local Dev Tunnel hosting, and Azure Container Apps deployment |
| Create an IQ + voice + avatar Agent | [`samples/create-agent-with-iq-avatar-voice/README.md`](samples/create-agent-with-iq-avatar-voice/README.md) | Portal-first Andrew Dragon HD, Harry Business, Knowledge IQ, and optional Python creation |
| Inspect SDK package information | [`dist/README.md`](dist/README.md) | Public Python and .NET SDK dependencies and historical preview build records |
| Use the coding-agent workflows | [`skills/`](skills/) | Voice Agent creation, IQ/Toolbox provisioning, and local-session debugging |

### Instructions for coding agents

When the user asks to run or debug something from this directory:

1. Verify that commands will run on Linux. For a Windows user, require a WSL2
   checkout in the WSL filesystem. If the checkout is under `/mnt/c/` or the
   terminal is native Windows, stop and guide the user to clone and reopen the
   repository in WSL2 before continuing. Exception: the standalone
   `samples/audio_file_rewrite/` sample supports native Windows; follow its README.
2. Select the component from the table above and read its `README.md` before
   running commands.
3. Treat **UI** without a qualifier as the general [`portal/`](portal/README.md).
4. Treat **Finance UI**, **portal Templates with Finance**, or
   **shared MCP UI** as the workflow documented in
   [`docs/03_run_samples.md`](docs/03_run_samples.md).
5. Reuse an existing component-local `.env` and virtual environment when they
   are valid. Never copy credentials or endpoints between unrelated `.env`
   files without the user's intent.
6. Start servers as long-running processes, verify their `/healthz` endpoint,
   and report the browser URL and log location. Do not report success merely
   because a process was spawned.
7. Do not silently fall back to mock data or a different Azure Project when
   authentication, endpoint, model, or preview checks fail.

For the default portal route, follow [`portal/README.md`](portal/README.md) to
prepare `portal/.env` and its `.venv`, start `portal/demo_server.py`, then
verify:

```text
GET http://127.0.0.1:9527/healthz
```

For the complete Finance route, follow the ordered
[`docs/README.md`](docs/README.md) workflow. The normal lifecycle commands are:

```bash
./scripts/setup-local-examples.sh --project-endpoint "https://<account>.services.ai.azure.com/api/projects/<project>"
./scripts/manage-local-mcp-and-ui.sh restart
./scripts/manage-local-mcp-and-ui.sh status
./scripts/manage-local-mcp-and-ui.sh stop
```

The setup command installs Node.js 22 and the Dev Tunnel CLI under the ignored
`.local-mcp-and-ui/tools/` directory when they are missing. It also supports
minimal Linux Python installations that provide `venv` but omit `ensurepip`:
each component environment receives its own bootstrapped `pip`. No `sudo` or
system package change is required for those three tools. Azure CLI must already
be installed and authenticated; Dev Tunnel device-code authentication remains
an explicit user action because setup must not authenticate as an identity the
user did not choose.

### Platform support

The supported repository working environment is Linux. On a Windows computer,
use **WSL2 for the entire repository workflow**, including the portal, samples,
MCP, deployment, and validation commands. The standalone
[`audio_file_rewrite` sample](samples/audio_file_rewrite/README.md) is an exception
and can run and be tested directly in Windows PowerShell:

1. Start a supported WSL2 Linux distribution.
2. Clone this repository again into the WSL filesystem, for example under
   `~/src/`. Do not run the workflow from a Windows checkout mounted under
   `/mnt/c/`.
3. Install Git, Python 3.10+, and Azure CLI inside WSL, then authenticate Azure
   CLI. The local setup script can install repository-local Node.js 22 and Dev
   Tunnel CLI copies. Azure Developer CLI is needed only for deployment.
   Windows-side CLI login state is not assumed to be shared.
4. The local setup, MCP E2E, and lifecycle scripts use native Python and never
   invoke Docker. Install Docker only when deliberately running the separate
   `shared_mcp/scripts/package.sh` image-packaging command; Azure Container
   Apps deployment uses a remote build.
5. Open the WSL checkout with VS Code Remote - WSL and run all commands from
   its WSL terminal.
6. Open the resulting `localhost` URL in the Windows browser; browser
   microphone permission remains on the Windows side.

Some individual component documents retain native PowerShell commands because
their code can run independently on Windows. They are not the recommended or
supported end-to-end repository workflow. Except for the standalone sample above,
native Windows execution, WSL1, and
running the checkout from `/mnt/c/` are outside the supported path.

### Directory map

| Path | Purpose |
| --- | --- |
| [`portal/`](portal/) | General local Voice Agent portal and WebRTC UI |
| [`samples/`](samples/) | Python, .NET, and Finance samples |
| [`docs/`](docs/) | Finance architecture, setup, operation, and debugging guides |
| [`shared_mcp/`](shared_mcp/) | Shared Finance MCP source, native runtime, optional container, IaC, and deployment scripts |
| [`scripts/`](scripts/) | Finance local setup and process lifecycle entry points |
| [`dist/`](dist/) | Public SDK package information and historical preview build records |
| [`skills/`](skills/) | Reusable coding-agent workflows |
| [`tests/`](tests/) | Offline contracts for the common Projects SDK samples |

### Security and environment boundaries

- Configure only Azure resources and identities the customer is authorized to
  use.
- Never place access tokens, API keys, connection secrets, or customer data in
  source files.
- Use Foundry Project connections or environment-based credentials.
- The portal and samples use Azure Foundry; running the local portal does not run
  the Azure voice service locally.
- Review each component's persistence and recording behavior before using
  sensitive prompts, audio, transcripts, or tool output.
