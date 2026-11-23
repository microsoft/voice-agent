# Voice Agent Cost Advisor - Projects SDK sample

## Conclusion

This sample publishes a single-node Voice Agent that tells a builder what their
voice agent calls will cost, recommends the cheapest setup that fits (model,
hosting, prompt layout and compaction) and lists concrete ways to pay less.
The Agent never calculates: every price, saving and percentage it says comes
from the `cost-advisor` route on the public no-auth MCP, which runs the cost
model of the [cost calculator](../../tools/cost_calculator/README.md) and checks
each tip against what measured calls showed.

Prices are planning estimates from list prices, not a quote or a bill.

## What the caller can ask

| Caller asks | Tool | The Agent says |
| --- | --- | --- |
| "What's the best setup for our calls?" | `cost_recommend_setup` | The cheapest model, hosting and prompt layout, its price per minute and the saving; also the best setup on the caller's current pipeline when the cheapest one changes it |
| "How can we make it cheaper?" | `cost_savings_tips` | The recommended changes, each as an action ("turn compaction off", "split the prompt into 5 stages") with its saving and what measured calls showed |
| "Should we turn on compaction?" | `cost_savings_tips` | Yes or no for that one change, and why |
| "What does a call cost?" | `cost_price_call` | The price per minute, then the largest cost line (STT, TTS, model input or model output) |
| "Compare these options" | `cost_compare_options` | The options cheapest first; BYOM prices are listed apart because they leave the model out |
| "Which models can I use?" | `cost_describe_options` | The models and hostings on the rate card |

A caller can also paste a share link from the cost calculator page; the Agent
passes it whole as `share_link`, and any input the caller states separately
overrides the link.

## How the advice is chosen

For the current option the route prices the four prompt layouts against each
other: one prompt or split into stages with handoffs, each with and without
compaction (replacing older turns with a short summary). It then recommends a
layout only when:

1. it can run: a realtime model accepts at most 16,384 instruction tokens in one
   node, so a larger prompt must be split;
2. measured calls did not show it costing more under similar inputs, even if the
   planning model shows a saving; such layouts are returned in
   `not_recommended` with the reason;
3. a change that measured calls confirmed saves needs any saving; a change that
   saved only in some cases, or was never measured, needs at least 5% in the
   planning model, because the model is more optimistic than measured calls
   about compaction.

When the current layout was measured to cost more (for example compaction every
few turns on a short realtime call with one prompt), the first tip says to undo
it, with the reason in `why_now`.

`cost_recommend_setup` takes the best layout of every managed option and ranks
them. Switching models changes answer quality and latency, so the Agent asks
the caller to test a recommended model on their own calls.

## MCP service

| Item | Value |
| --- | --- |
| Route | `/mcp/cost-advisor` on the public no-auth MCP |
| Tools | `cost_recommend_setup`, `cost_savings_tips`, `cost_price_call`, `cost_compare_options`, `cost_describe_options`; no prefix, the route is the namespace |
| Auth | None. The Agent binds a direct `server_url`; there is no Project connection. |
| State | None. Every call carries all of its inputs; the tools are read-only. |
| Cost model | A port of the cost calculator page's pricing model and rate card, checked against the page's own prices |

The public host runs its own deployment of this route; it is not part of this
repository.

## Publish and run

```bash
cp .env.example .env   # set AZURE_AI_PROJECT_ENDPOINT
python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python sample.py publish
.venv/bin/python sample.py run --expect-mcp \
  --message "We run 10-minute support calls on GPT Realtime 2.1 with one 2,000-token system prompt and 6,000 tokens of logic. What's the best setup for us?" \
  --message "How else can we make it cheaper?" \
  --message "Should we turn on compaction?" \
  --message "Thanks, that's all."
```

Leave `VOICE_AGENT_MCP_CONNECTION_ID` empty for the no-auth MCP.

### Microsoft Realtime Flash variant

`agent.json` runs on GPT Realtime 2.1 (`--variant realtime`, the default). `agent.flash.json` is the same Agent
on `microsoft-realtime-flash-1`, published as `voice-agent-cost-advisor-flash`:

```bash
.venv/bin/python sample.py publish --variant flash
.venv/bin/python sample.py run --variant flash --expect-mcp --message "Compare the standard options for a 15-minute call."
```

The two files differ only in the model, the name and the tool names in the instructions. GPT Realtime runs MCP
natively, so the model calls `cost_price_call`. Flash runs MCP in the voice agent, which registers each tool as
`{server_label}_{tool}`, here `cost_cost_price_call`. When the instructions named the tools the native way, Flash
called names that were not registered, the calls never ran and the turn went silent (3 of 12 evaluation cases
passed). With the registered names it passed 11 of 12. One set of instructions cannot serve both, so keep the
files in step when you change the instructions.

Flash runs only in some regions (Central India, and South India and Southeast Asia through it); publish it to a
project in one of those.

## Try these turns

- "What does a 15-minute call on GPT Realtime 2.1 mini cost per minute?" then
  "And if the call lasts 30 minutes?"
- "We already compact the history every 10 turns on GPT Realtime 2.1 with one
  prompt, and our calls are about 8 minutes. Is that saving us money?" Expect
  the Agent to say to turn compaction off, and why.
- "Our agent on GPT Realtime 2.1 has one prompt with 3,000 tokens of rules and
  20,000 tokens of business logic. What should we change?" Expect a split into
  stages.
- "We'll bring our own GPT-4.1 deployment on PTU. What will the voice agent
  cost?" Expect the voice agent cost plus the model on their own deployment.
- "How much does GPT-7 Ultra cost?" Expect that it is not on the rate card.

## Limits

- Rates are a dated list-price snapshot; the route reports the date in
  `cost_describe_options`.
- BYOM prices only what the voice agent bills (STT and TTS); the model on the
  customer's own deployment is not priced, and PTU is not sized.
- The recommendation compares models, hostings and the four layouts; it does not
  choose the number of stages.
- English only.
