# Foundry GPT Live in the browser with the Azure AI Projects SDK for JavaScript

A simple browser version of the [Python GPT Live samples](../python/README.md): talk to an
English-teacher GPT Live agent with your microphone, hear the teacher's reply, and watch the
GPT Live, Delegation, and You panes update.

A small Node.js server does the Azure work with the preview `@azure/ai-projects` package. It
creates or reuses the agents through `AIProjectClient.agents` and opens one GPT Live session
per page through the SDK's Live client, `project.beta.voiceAgents.live.connect(...)`. The page
streams microphone audio to the server and plays the audio it relays back. Your `az login`
credential stays on the server; the browser never receives a token.

The GPT Live APIs are not in an npm release yet, so `package.json` installs the bundled
preview package `dist/azure-ai-projects-2.10.0.tgz`; see
[`dist/README.md`](../../../dist/README.md) for its source and checksum.

## Files

| File | Description |
| --- | --- |
| `server.mjs` | Prepares the agents, serves the page on `127.0.0.1`, relays `/live` WebSocket sessions, and cleans up on Ctrl+C. |
| `agents.mjs` | Settings, agent definitions, and the create/reuse/delete lifecycle, mirroring the Python samples. |
| `live_relay.mjs` | Turns Live events into page messages, as the Python samples do for their panes, and forwards microphone audio. |
| `public/` | The page: `index.html`, `app.js`, `pcm-audio.js` (Web Audio capture and playback), `pcm-capture.js` (AudioWorklet), and `style.css`. |
| `test/` | Offline agent, relay, and HTTP tests. |
| `package.json` / `package-lock.json` | Dependencies, including the bundled preview `@azure/ai-projects` package. |

## How to run

Requires Node.js 22+, Azure CLI, Chrome or Edge, a microphone (headphones recommended), and a
Foundry project with the Voice Agents / GPT Live preview, a GPT Live deployment, and a
Responses deployment. Configure the shared `samples/gpt_live/.env` as described in
[`../README.md`](../README.md), then from this folder:

```powershell
npm ci
npm start
```

`npm ci` installs the bundled package from `../../../dist` (the path is relative to
`package.json`). The lockfile records the public npm registry; npm uses your configured
registry instead when you have one.

Open the printed address, `http://localhost:8080`, click **Start**, allow the microphone,
and wait for **Ready**. Then ask, for example, **"Please correct my English: I goed to school
yesterday. Explain why."** Click **Stop** to end the lesson; the page shows the session's
close reason, Live usage, and Foundry conversation ID. Each **Start** opens a new session.
Press **Ctrl+C** in the terminal to stop the server.

### Responses delegation (default)

`npm start` creates an English-teacher GPT Live agent with Responses delegation and
`store: true`, or reuses `AGENT_NAME` without creating, updating, or deleting it. The
Delegation pane shows each delegation's status and the Responses backend's guidance, which is
separate from what the teacher says. A client-target delegation receives commentary tied to
its ID; a backend failure ends the session with an error.

### Managed prompt-agent delegation

```powershell
npm run managed
```

This creates two fresh agents and ignores `AGENT_NAME`: an English-teacher prompt agent with
a `[commentary]`/`[thinking]` tagged-text contract, then a GPT Live voice agent pinned to the
prompt agent's exact returned version with `"type": "foundry_managed_agent"`. Foundry runs the
prompt agent and forwards accepted guidance; the page only streams audio and shows events:

- `session.delegation.created` with `target: "foundry_managed_agent"` reports Foundry's
  ownership. Native `client` or `responses` targets end the session, with no fallback executor.
- The prompt agent's Responses stream arrives as `response.event` with that delegation ID; the
  Delegation pane shows its status and raw tagged-text output.
- Each `session.commentary.appended` or `session.thinking.appended` marks the latest
  delegation's accepted guidance as forwarded to GPT Live. Backend failures stay visible
  without ending the session.

### Keeping or deleting agents

Agents created by the server are kept when it stops, so you can reconnect or download
conversations later; the server console prints a command for the shared Python
[`download_conversation_artifacts.py`](../../download_conversation_artifacts.py) after each
session. Add `-- --auto-delete` (for example `npm start -- --auto-delete`) to delete only the
agents this run created when you press Ctrl+C, voice agent first. Use `-- --port 9000` to
change the port.

The server listens on `127.0.0.1` only and accepts Live connections only from its own page,
so other websites cannot use your credential through it.

## Tests

Run the offline tests (no Azure resources, browser, or audio devices). They drive the real
Projects SDK client: agent calls go to an in-memory HTTP client, the Live client talks to a
scripted WebSocket transport, and a `ws` client stands in for the page.

```powershell
npm test
```
