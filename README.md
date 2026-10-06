# Voice Agent in Foundry Agent Service - Community Hub
[Voice Agent in Foundry Agent Service](https://learn.microsoft.com/en-us/azure/foundry/agents/quickstarts/prompt-voice-agent?pivots=portal) offers below key values to customers:


> Build and launch an enterprise-ready voice agent in under two minutes. Choose speech-to-speech or cascaded pipelines powered by OpenAI, Microsoft AI, and Azure real-time models.  Extend your agent with Foundry tools, monitor and measure its performance, and connect inbound and outbound calls through Teams and Twilio. Create engaging conversations with voices optimized for call centers and lifelike avatars.

This repository is the official community hub for Voice Agent in Foundry Agent Service. Here you'll find:

🐛 Report Issues — File bugs, feature requests, and feedback via [GitHub Issues](https://github.com/microsoft/voice-agent/issues)

📚 Resources — Curated links to docs, videos, blogs, and community content for Voice Agent

🧪 Samples — Hands-on samples and extended solutions

## What's New ![New](assets/whats-new-animated.gif)

Voice Agent is now available in **public preview**, making voice a first-class modality in Foundry Agent Service. We've received great feedback from customers and are working with them to move their voice agents into production as we prepare for general availability (GA).

# Voice Agent and Voice Live

[Voice Live](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live) is the foundation for real-time voice interaction, and Voice Agent builds on that foundation to deliver complete voice-first agents. Voice Live handles the real-time voice experience, while Voice Agent adds the intelligence, tools, knowledge, and orchestration required to build end-to-end agentic applications.

For most customers building voice-first agents, we recommend starting with Voice Agent. Voice Agent provides the more complete, integrated experience for building and operating an agent, bringing together voice, reasoning, instructions, knowledge, tools, and orchestration. Voice Live is a better fit when customers already have their own agent stack and primarily need real-time voice capabilities with greater control over the voice application architecture.

## Quick Links

| Resource | Description |
| --- | --- |
| [Product home page](https://azure.microsoft.com/en-us/products/ai-foundry/agent-service) | Explore Foundry Agent Service, including voice capabilities. |
| [New Foundry portal — Create & manage agents](https://ai.azure.com/nextgen) | Create and manage voice agents in the new Foundry portal. |
| [Documentation & quickstart](https://learn.microsoft.com/en-us/azure/foundry/agents/quickstarts/prompt-voice-agent?pivots=portal) | Create a voice-based prompt agent, customize its instructions, and test spoken conversations. |
| [Configure a voice agent](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/configure-voice-agent) | Configure your voice agent's behavior and voice settings. |
| [Use a hosted agent as the conversation engine](https://learn.microsoft.com/en-us/azure/foundry/how-to/voice-first-with-hosted-agent) | Use a hosted agent for conversation logic and tools, while Voice Live handles speech, turn-taking, and interruptions. |
| [Use a subagent in a voice-based agent](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/use-subagent-voice-first-agent) | Delegate specialized requests to prompt or hosted subagents in the same Foundry project. |
| [Voice Agent tracing, monitoring & evaluation](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/voice-agent-observability) | Monitor voice sessions and evaluate conversation transcripts using datasets, traces, or simulations. |
| [Pricing & billing](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/voice-agent-pricing) | Understand Voice Agent pricing and billing. |
| [Foundry Voice Agent samples](https://github.com/microsoft-foundry/foundry-samples) | [Python](https://github.com/microsoft-foundry/foundry-samples/tree/main/samples/python/voice-agents) · [Java](https://github.com/microsoft-foundry/foundry-samples/tree/main/samples/java/voice-agents) · [JavaScript](https://github.com/microsoft-foundry/foundry-samples/tree/main/samples/javascript/voice-agents) · [TypeScript](https://github.com/microsoft-foundry/foundry-samples/tree/main/samples/typescript/voice-agents) · [C# / .NET](https://github.com/microsoft-foundry/foundry-samples/tree/main/samples/csharp/VoiceAgents) · [Browser voice console](https://github.com/microsoft-foundry/foundry-samples/tree/main/samples/javascript/voice-agents/browser-voice-console) |
| [Extended Voice Agent samples](https://github.com/microsoft/voice-agent/tree/main/samples) | Explore runnable samples and extended solutions. |
| [Voice Agent integration with Teams](https://github.com/Azure-Samples/voicelive-webapp) | [Teams meeting delegate sample](https://github.com/Azure-Samples/voicelive-webapp/tree/main/samples/teams-meeting-delegate) connecting a Foundry Voice Agent and avatar to Teams through Azure Communication Services. |
| [Regions & quotas](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/limits-quotas-regions) | Check the shared Foundry Agent Service region and quota documentation. |
| [Contact the Voice Agent team](mailto:voiceagent@microsoft.com) | Email voiceagent@microsoft.com with questions and feedback. |
| [Python SDK](https://github.com/Azure/azure-sdk-for-python/blob/main/sdk/ai/azure-ai-projects/README.md) | azure-ai-projects for agent management and realtime voice sessions. |
| [Java SDK](https://github.com/Azure/azure-sdk-for-java/blob/main/sdk/ai/azure-ai-agents/README.md#realtime-voice-agent-sessions) | com.azure:azure-ai-agents for voice sessions, conversations, and telephony. |
| [JavaScript / TypeScript SDK](https://github.com/Azure/azure-sdk-for-js/blob/main/sdk/ai/ai-projects/README.md) | @azure/ai-projects for agent management and realtime voice sessions. |
| [C# / .NET SDK](https://github.com/Azure/azure-sdk-for-net/blob/main/sdk/ai/Azure.AI.Projects.Agents/README.md) | Azure.AI.Projects.Agents for voice agent definitions and management. |

In the Foundry portal, open your project, go to **Build > Agents**, select **Build an agent**, and choose **Voice** as the interaction mode.

Voice Agent is now available in public preview. Customers can start building voice agents and preparing for production.

Explore [Voice Agent in Foundry Agent Service](#voice-agent-extended-samples) for voice agent guides, portal links, and runnable samples.

## Voice Agent Videos

**Short demo (720p, 1:38)**

https://github.com/user-attachments/assets/6dc991a6-276a-40f5-b6d4-20100d823ca9

**Full walkthrough (1080p, 15:11)**

https://github.com/user-attachments/assets/c62c179a-f181-4d29-ab99-c84dc6091fdd

## Voice Agent Blogs

- 2026.09 [**Ship agents faster with expanded model choice, voice agents, and continuous optimization**](https://azure.microsoft.com/en-us/blog/ship-ai-agents-faster-with-new-capabilities-in-microsoft-foundry-expanded-model-choice-voice-agents-and-built-in-optimization/) — Overview of the latest Foundry Agents capabilities, including a Voice Agent video overview.
- 2026.09 [**Introducing voice agents in Microsoft Foundry**](https://aka.ms/VoicefirstagentsSept2026) — Voice Agent public preview announcement.
- 2026.06 [**Azure Speech at Build 2026: Powering Voice Agents with Real-Time and Life-like Experiences**](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/azure-speech-at-build-2026-powering-voice-agents-with-real-time-and-life-like-ex/4524638) — Azure Speech updates from Build 2026 for real-time voice agents and lifelike experiences.
- 2025.11 [**Advancing Speech Innovation with Azure Speech in Microsoft Foundry**](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/advancing-speech-innovation-with-azure-speech-in-microsoft-foundry/4471461) — Azure Speech innovations in Microsoft Foundry for conversational AI and voice agents.
- 2025.09 [**Upgrade your voice agent with Azure AI Voice Live API**](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/upgrade-your-voice-agent-with-azure-ai-voice-live-api/4458247) — General availability announcement for Voice Live API, enabling real-time speech-to-speech voice agents.
- 2025.05 [**Voice-enabled AI Agents: transforming customer engagement with Azure AI Speech**](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/voice-enabled-ai-agents-transforming-customer-engagement-with-azure-ai-speech/4413537/) — Voice Live API public preview announcement at Microsoft Build 2025.

## Voice Agent Customer Stories

- [**Astra Tech brings Voice Live API in Azure AI Foundry to its fintech-first app**](https://www.microsoft.com/en/customers/story/25412-astra-tech-azure-ai-foundry) — Astra Tech uses Voice Live in **botim** for a multilingual voice assistant that helps users complete tasks such as international money transfers. The story reports **300,000 monthly active users and 100,000 daily active users**.
- [**Boosting patient satisfaction with healow Genie and Voice Live API in Azure AI Foundry**](https://www.microsoft.com/en/customers/story/25363-healow-azure-kubernetes-service) — The article describes a Voice Live pilot for **healow Genie**, covering appointment information, common questions, and voicemail callbacks. **Pilot:** It discusses anticipated benefits rather than measured improvements from a completed rollout.
- [**Kansai Television: AI Hachiemon**](https://www.microsoft.com/en-us/ailab/case-study/kansai-television) — Microsoft AI Co-Innovation case study. Kansai Television built a conversational version of its mascot, **Hachiemon**, using Voice Live and Azure AI Foundry. Azure AI Speech Custom Voice recreates the character's distinctive voice for entertainment and interactive experiences.

## Voice Agent Quality And Scalability

### Latency

Speech-to-speech models can achieve latency as low as **500 ms** on service side. Cascaded pipelines (**STT → LLM → TTS**) can also deliver low latency < 1s with the right LLM and streaming speech configuration. Actual latency depends on the model, region, network conditions, and tool calls.

### Speech and model quality

Voice Agent brings together advanced speech and language models, including [GPT Realtime](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live-how-to), [GPT Live](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/gpt-live), Azure speech-to-text and [HD voices](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=text-to-speech), and MAI Transcribe and MAI Voice. Choose the combination that best fits your languages, domain, and conversational experience.  For more resources and samples for Azure Speech HD / MAI voices, visit the [Azure Text-to-Speech repository](https://github.com/Azure-Samples/Cognitive-Speech-TTS).

Recent speech benchmark references:

- **2026.10** [MAI-Transcribe-2-Streaming benchmark results](https://microsoft.ai/news/our-first-streaming-transcription-model/) — Microsoft reports first place for final and partial transcript accuracy on Artificial Analysis in its October 1 announcement.
- **2026.09** [MAI-Transcribe-2 benchmark results](https://microsoft.ai/news/mai-transcribe-2-is-the-fastest-most-accurate-and-cheapest-speech-recognition-model-in-the-world/) — Microsoft reports first place on FLEURS across 60 languages and second place on the Artificial Analysis word error rate leaderboard in its September 3 announcement.
- **2026.06** [Azure LLM Speech benchmark results at Build 2026](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/azure-speech-at-build-2026-powering-voice-agents-with-real-time-and-life-like-ex/4524638) — Microsoft reports first place on the Open ASR Leaderboard for the updated LLM Speech model in its Build 2026 announcement.

### Customization

1. **Speech-to-speech — Azure Realtime:** Custom voices are available **upon request**. Contact [voiceagent@microsoft.com](mailto:voiceagent@microsoft.com) to discuss access. See the [Azure Realtime voice configuration reference](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live-api-reference-2026-06-01-preview) for the publicly documented native voice settings.
2. **Cascaded pipelines — speech recognition and synthesis:** Adapt recognition to your vocabulary and audio conditions with [Azure Custom Speech](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/custom-speech-overview). Create a distinctive voice with [Azure Custom Voice](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/custom-neural-voice), or use [MAI Voice customization](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-voices) to create a voice from a short reference recording through the documented access and consent workflow.

### Scalability

Voice Agent can scale to meet your business needs. Customers are already using it to run **more than 3,000 concurrent sessions** and are continuing to scale. For large-scale deployments with high concurrency requirements, contact us to discuss your capacity and scalability needs.

---

## Voice Agent Extended Samples

### Start here

This directory is the entry point for the Voice Agent portal, runnable samples,
the Finance reference workflow, and its shared MCP service. Detailed setup and
operation instructions live with the component that owns them; this file routes
users and coding agents to the correct entry point.

See [Platform support](#platform-support) for workflow-specific operating-system
requirements.

For an unqualified request such as **"run the UI"** or **"start the portal"**,
use [`portal/`](portal/README.md). It is the general Voice Agent UI and runs on
`http://127.0.0.1:9527` by default. Do not start the Finance MCP stack unless
the request mentions Finance, Templates, or the shared MCP.

### Portal + local MCP quickstart

Use this path when the portal must publish or run the checked-in Templates.
It is the recommended end-to-end workflow:

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
| Run realtime speech transcription | [`samples/realtime_stt/README.md`](samples/realtime_stt/README.md) | MAI Transcribe 2 or Azure Speech with VAD, microphone or WAV input, disabled LLM responses, and reported session usage |
| Run Data Zone and regional realtime voice agents | [`samples/realtime_datazone_voice_agent.md`](samples/realtime_datazone_voice_agent.md) | East US 2 `gpt-realtime-2.1-datazone` with US inference, Japan East `azure-realtime` with confirmed GPU routing, and eligible Central India `gpt-realtime`; model-specific voices and microphone setup |
| Run the GPT Live terminal sample | [`samples/gpt_live/README.md`](samples/gpt_live/README.md) | Create or reuse a GPT Live agent, stream microphone audio with the OpenAI SDK, and view independently scrollable GPT Live, delegation, and user transcripts |
| Run the complete Finance workflow | [`docs/README.md`](docs/README.md) | Ordered subscription, MCP, sample, portal, and debugging guides |
| Work on or deploy the Finance MCP | [`shared_mcp/README.md`](shared_mcp/README.md) | Shared MCP image, Finance routes, local Dev Tunnel hosting, and Azure Container Apps deployment |
| Create an IQ + voice + avatar Agent | [`samples/create_agent_with_iq_avatar_voice/README.md`](samples/create_agent_with_iq_avatar_voice/README.md) | Portal-first Andrew Dragon HD, Harry Business, Knowledge IQ, and optional Python creation |
| Inspect SDK package information | [`dist/README.md`](dist/README.md) | Public Python and .NET SDK dependencies and historical preview build records |
| Use the coding-agent workflows | [`skills/`](skills/) | Voice Agent creation, IQ/Toolbox provisioning, and local-session debugging |

### Instructions for coding agents

When the user asks to run or debug something from this directory:

1. Verify the environment follows [Platform support](#platform-support) for the
   selected workflow before running commands.
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

**Standalone samples do not inherently require WSL.** Their Python and .NET
runtimes are not Linux-specific. On Windows, use native PowerShell and follow
the selected sample's package, audio-device, Azure identity, and service-access
prerequisites. Bash examples in a sample guide may need equivalent PowerShell
syntax; that alone is not a Linux runtime requirement.

| Sample group | Native Windows guidance |
| --- | --- |
| [Common Python samples](samples/README.md) | Python 3.10+; includes basic voice, MCP, Foundry IQ, local functions, Toolbox, REST lifecycle, and downloaders. Microphone samples also need PyAudio and working audio devices. |
| [Data Zone and regional realtime](samples/realtime_datazone_voice_agent.md) | Uses the common Python prerequisites and provides PowerShell commands without activation. |
| [Audio rewrite and translation](samples/audio_transcribe_and_translate/README.md), [language learning](samples/language_learning/README.md) | Python 3.11+; follow each sample's separate dependencies and audio requirements. |
| [Realtime STT](samples/realtime_stt/README.md) | Python 3.13+; supports microphone or WAV input. |
| [GPT Live](samples/gpt_live/README.md) | Python 3.11+; provides native PowerShell setup and terminal microphone commands. |
| [Prompt subagent](samples/subagent/voice_subagent_prompt_basic/README.md), [hosted subagent](samples/subagent/voice_subagent_hosted_agent/README.md), [microphone client](samples/subagent/client/README.md) | Python 3.10+; provide PowerShell setup and client commands. |
| [C#](samples/CSharp/README.md) | .NET 8+; runs with PowerShell and does not require microphone or speaker access. |
| [Foundry voice web sample](samples/foundry_voice_webrtc/README.md) | Python 3.11+ and a browser; local setup and cloud deployment have PowerShell commands. Its Linux container image does not require WSL on the local host. |
| [IQ, voice, and avatar creation](samples/create_agent_with_iq_avatar_voice/README.md) | The Python validator and SDK creation client have no Linux-only dependency; the recorded WSL run in its guide is not a requirement. |
| [Finance handoff](samples/example1_finance_with_handoff/README.md), [Finance OTP](samples/example2_finance_with_OTP_and_Officer_Search/README.md), [Elevator](samples/example3_elevator_service_with_safety_zendesk_and_handoff/README.md) | Python publish/check/connect/run clients do not require WSL when their MCP endpoint and Project connection are already configured. Bundled MCP automation is a separate workflow. |

This distinguishes runtime dependencies from a guarantee that every live Azure,
microphone, or preview feature has been validated on every operating system.

**The checked-in combined portal + local MCP automation requires Linux; on
Windows, use WSL2.** `scripts/setup-local-examples.sh` installs Linux x64 tools
and assumes Unix virtual-environment paths. `scripts/manage-local-mcp-and-ui.sh`
uses Linux `/proc`, process groups, and `setsid`. This requirement applies to
those scripts and the combined quickstart, not to all samples.

Other `.sh` wrappers, such as `portal/run.sh` and the shared MCP deployment
scripts, require Bash/Unix tooling as written. Do not infer a Linux requirement
for the underlying Python application merely from a Bash launch command.

For the Linux-dependent automation on Windows:

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

## Voice Live Related Links
| Resource | Description |
| --- | --- |
| [Voice Live samples](https://github.com/microsoft-foundry/voicelive-samples/) | Referrence only. Voice Live Quickstarts and examples for Python, C#, Java, and JavaScript/TypeScript, including Foundry agent integration, MCP tools, and avatars. We recomend starting with Voice Agent now instead of Voice Live  |
| [Call Center Voice Agent Accelerator](https://github.com/Azure-Samples/call-center-voice-agent-accelerator) | Referrence only. A template for speech-to-speech call center agents using Voice Live, with browser and telephony integration and deployment to Azure Container Apps. We recomend starting with Voice Agent now instead of Voice Live. Now Voice Agent has supported Twillio and Teams Phone and we will add more support soon.  |
| [Voice Live overview](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live) | Referrence only. Learn about real-time voice interactions with speech recognition, language models, and speech synthesis. |
| [Hosted agents overview](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/hosted-agents) | Referrence only. Learn how to deploy custom agent applications on managed infrastructure. |
| [Voice Live with hosted agents](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-voice-live-hosted-agent-integration) | Referrence only. Add voice interaction to hosted agents using the Responses or HTTP Invocations protocol; includes Python client and agent examples. |
| [Voice Live Bridge sample](https://github.com/microsoft-foundry/foundry-samples/tree/main/samples/python/hosted-agents/bring-your-own/voice-agent-target-agent/basic) | Deploy a hosted conversation engine and a voice wrapper, with Voice Live handling speech and interruptions. |
| [Build a voice agent with invocations_ws](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/build-voice-agent) | Referrence only. Build hosted voice agents over WebSocket with Voice Live, Pipecat, or LiveKit. |
| [invocations_ws voice agent samples](https://github.com/microsoft-foundry/foundry-samples/tree/main/samples/python/hosted-agents/bring-your-own/invocations_ws) | Referrence only. Explore hosted voice agent code using WebSocket audio streaming or signaling for separate media transport. |
