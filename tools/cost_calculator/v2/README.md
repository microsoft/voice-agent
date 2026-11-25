# Voice-agent cost walkthrough - a voice Agent that breaks the price down

## Conclusion

A web page that estimates what one minute of a Voice Agent call costs and shows why. You pick a model and
hosting, the call length and how the prompt is organised; the page shows the price per minute and a cost tree
you can open level by level: STT, TTS, model input (uncached and cached) and model output. A voice Agent opens
from the top of the page, sets the inputs, narrates the breakdown and answers "what if" questions.

The numbers are planning estimates, not a quote. How the price is worked out is still being settled and may
change between versions, so use the page to see what drives the cost rather than as a price list.

The voice plumbing and loopback server follow [ignite_planner](../../../samples/ignite_planner/README.md).

## What it does

- Prices the call response by response: each response re-sends the instructions and the history, and what an
  earlier response already sent is priced at the cached rate. Handoffs and compaction change what stays cached,
  and the tree shows the effect. No cache hit rate goes in; the cached share is worked out.
- Covers managed models (the voice agent hosts the model and bills its tokens) and BYOM (the model runs on the
  customer's own Foundry deployment and is billed there; the page shows only the voice-agent cost as
  "X ¢/min + model").
- Lists ways to pay less, each with the saving the model calculates.
- Keeps the current settings in the address bar, so a link reopens the same calculation; **Export Excel**
  downloads the breakdown with live formulas.

Rates come from the Azure Retail Prices snapshot in `tools/cost_calculator/prices.json` (2026-10-22).

## Layout

```text
v2/
├── server.mjs   Loopback helper: creates or reuses the Agent, serves the page, gives the page an az-login token
├── agent/       Agent definition sent to Foundry: agent.mjs, prompt.txt, tools.json
├── web/         Browser files: pricing, the cost tree, animations, results, page functions and voice island
└── tests/       Node unit tests and golden values; tests/browser/ holds Playwright page tests
```

## Run

Requirements: Node.js 22+, the Azure CLI, and a Foundry project with Voice Agents. There is no
`npm install`. Run the commands in this directory.

```bash
node server.mjs --preview --port 8781   # page only, no Azure calls: "Walk me through it" autoplays
az login
node server.mjs                          # port 8780, reads ./.env
```

| Variable in `.env` | Default |
| --- | --- |
| `AZURE_VOICE_AGENTS_ENDPOINT` | Required for voice, for example `https://<account>.services.ai.azure.com/api/projects/<project>` |
| `AZURE_VOICE_AGENTS_MODEL` | `gpt-realtime` |
| `AZURE_VOICE_AGENTS_VOICE` | `en-US-AvaNeural` |

The Agent name, `cost-walkthrough-js-<hash>`, is derived from the prompt, tools and voice: unchanged
settings reuse it, changes create a new one and leave the old one in Foundry for you to delete. The
server listens on `127.0.0.1` only and gives the `az login` token only to a same-origin page; do not
expose it to other users. Open `http://localhost:8780`, select **Ask the cost guide**, and try:

- "Walk me through what a 15-minute call on GPT Realtime 2.1 costs."
- "What if the call lasts 30 minutes?"
- "How could I make this call cheaper?"

To rehearse without Azure, run this in the browser console; it takes the same path as an Agent call:

```js
costDemo.simulateAgentCall('set_parameters', {model: 'gpt-4.1', hosting: 'byom', logic_tokens: 12000})
```

## Tests

```bash
node --test tests/*.mjs        # pricing against golden values, cost tree, page functions, savings, share links, export, server
```

Page tests use Playwright (`pip install playwright` and `playwright install chromium`):

```bash
node server.mjs --preview --port 8781 &
python tests/browser/test_ui_browser.py --url http://127.0.0.1:8781
python tests/browser/test_live_browser.py --url http://127.0.0.1:8780   # real Azure, uses quota
```

Screenshots and the transcript go to `artifacts/` (ignored by Git).

## Limits

- The price is an estimate from a model checked against a limited set of measured calls; the method and its
  inputs may change.
- BYOM prices only what the voice agent bills, not the model on the customer's deployment. Native
  speech-to-speech output and GPT Live are not covered. Rates are a 2026-10-22 snapshot.
- English only. The current Agent definition has not been run live with a microphone yet.
- Narration sync matches the spoken numbers in the transcript; if the Agent rewords a number, that part
  is skipped and the next one still opens.
- The browser handshake relies on a preview `api-version`, as in `ignite_planner`.
