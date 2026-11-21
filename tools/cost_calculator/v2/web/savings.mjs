// Ways to pay less, for the inputs on the page. Each tip prices the call with and without the change through
// priceCall() and sets that against what the team measured on real calls under conditions like the current inputs.
// verdict: 'saves' (measured to save), 'depends' (measured to save only under conditions these inputs may not
// meet), 'costs-more' (measured to cost more under these inputs), 'model' (not measured; the model only).
// Measured numbers come from the team's live-call cost measurements, which are not published here.
import {priceCall} from './pricing.mjs';
import {SCHEMES} from './rate-card.mjs';
import {callDrivers} from './inputs.mjs';

const cpm = r => r.perMinute * 100;
const int = n => Math.round(n).toLocaleString('en-US');
const REALTIME_NODE_LIMIT = 16384;
const BYOM_WHY = 'On BYOM this changes only the model bill on your own deployment, which is not priced here; the voice-agent cost (STT and TTS) stays the same.';
const cascade = scheme => scheme.mode === 'speech';

function handoffTip(p, scheme) {
  const removed = p.logicTokens - callDrivers({...p, promptDesign: 'stage'}, scheme).logicPerResponse;
  const rule = `A switch rarely pays back when it removes under 4,000 tokens from each request; here it removes ${int(removed)}.`;
  let verdict, evidence;
  if (scheme.hosting === 'byom') {
    verdict = 'model';
    evidence = BYOM_WHY;
  } else if (scheme.mode === 'realtime') {
    if (p.systemPromptTokens + p.logicTokens > REALTIME_NODE_LIMIT) {
      verdict = 'saves';
      evidence = `Required: one realtime node accepts at most ${int(REALTIME_NODE_LIMIT)} instruction tokens, and this prompt has ${int(p.systemPromptTokens + p.logicTokens)}. Measured: 32k split into 4 stages cost 10% less than 8.`;
    } else if (p.logicTokens < 5000) {
      verdict = 'costs-more';
      evidence = `Measured on GPT Realtime 2.1: splitting a linear prompt under 5k tokens cost 31% more in 4 stages and 57% more in 8, because each switch sends the history again at the full price. ${rule}`;
    } else if (p.logicTokens < 12000) {
      verdict = 'depends';
      evidence = `Measured on GPT Realtime 2.1 with 8k of logic: 2 stages saved 6%, 8 stages cost 21% more. ${rule}`;
    } else {
      verdict = 'saves';
      evidence = 'Measured on GPT Realtime 2.1 with 12–15k of logic: 2–4 stages saved 13–19% (19% on 14-minute calls); 8 stages saved only 4% and passed 7 of 10 business checks.';
    }
    evidence += ' Branching at the first sentence (if/else: each call takes one branch) saved 23–36%. Splitting pays most together with compaction at each handoff.';
  } else if (scheme.tier === 'Lite tier') {
    verdict = 'depends';
    evidence = 'Measured on the Cascade pipeline: on Lite every prompt strategy stayed within ±5%, because STT and TTS are about 90% of the cost.';
  } else {
    verdict = 'depends';
    evidence = 'Measured on Cascade Pro with a 32k–64k prompt and no compaction: 4 stages cost 12.3% and 4.4% less than one prompt, 8 stages 5.3% and 14.1% more; this model puts them at +3.0%, +6.4%, +19.0% and +14.9%, so it overstates the cost of a split. Splitting alone saved 17% on the Standard tier.';
  }
  return {id: 'handoff', title: 'Split the prompt by stage (handoff)', active: p.promptDesign === 'stage',
    with: {promptDesign: 'stage'}, without: {promptDesign: 'single'}, verdict, evidence,
    how: 'Keep the system prompt first and identical in every stage node; each node carries only its own stage logic.',
    note: 'Priced response by response, with the handoff call and the full-price request after each switch.'};
}

// The combination the measurements favour, offered from one prompt: split by stage and compact at each handoff.
function splitCompactTip(p, scheme) {
  if (p.promptDesign === 'stage') return null;
  let verdict, evidence;
  if (scheme.hosting === 'byom') {
    verdict = 'model';
    evidence = BYOM_WHY;
  } else if (scheme.mode === 'realtime') {
    const short = p.logicTokens < 5000;
    verdict = short ? 'depends' : 'saves';
    evidence = 'Measured on GPT Realtime 2.1: compacting at each handoff saved 29.6% against the same split without it'
      + (short ? ', but splitting a linear prompt under 5k tokens alone cost 31% more; the two together were not measured against one prompt.'
        : p.logicTokens < 12000 ? ', and with 8k of logic splitting alone saved 6% in 2 stages.' : ', and with 12–15k of logic splitting alone saved 13–19% in 2–4 stages.');
  } else if (scheme.tier === 'Lite tier') {
    verdict = 'depends';
    evidence = 'Measured on the Cascade pipeline: on Lite every strategy stayed within ±5%, because STT and TTS are about 90% of the cost.';
  } else {
    verdict = 'saves';
    evidence = 'Measured on the Cascade pipeline: summarising at the handoff saved 27.9% on Pro, and splitting plus summaries saved 27% on Standard.'
      + ' This model is 4.3–8.4 points more optimistic than the measured compaction savings.';
  }
  return {id: 'handoff_compaction', title: 'Split the prompt by stage and compact at each handoff', active: false,
    with: {promptDesign: 'stage', summarise: true}, without: {}, verdict, evidence,
    how: 'Give each stage its own node behind the same system prompt, and at each handoff replace the finished stage with a short summary of what it collected.'};
}

function compactionTip(p, scheme) {
  const split = p.promptDesign === 'stage';
  let verdict, evidence;
  if (scheme.hosting === 'byom') {
    verdict = 'model';
    evidence = BYOM_WHY;
  } else if (scheme.mode === 'realtime') {
    if (split) {
      verdict = 'saves';
      evidence = 'Measured on GPT Realtime 2.1: compacting the finished stage at the handoff saved 29.6% against the same split without it.';
    } else if (p.minutes <= 15) {
      verdict = 'costs-more';
      evidence = 'Measured on GPT Realtime 2.1 with one prompt: compacting every few turns cost 4–11% more on 5–10 minute calls and did not save at 15.8 minutes, because each compaction makes the kept audio pay $32 instead of $0.40 per 1M once.'
        + ' The response-by-response model is more optimistic than those calls for this strategy.';
    } else {
      verdict = 'depends';
      evidence = 'Measured on GPT Realtime 2.1: with one prompt, compaction pays only after 15–20 minutes, at most every 10–12 turns, with summaries written by a cheaper text model.';
    }
  } else if (scheme.tier === 'Lite tier') {
    verdict = 'depends';
    evidence = 'Measured on the Cascade pipeline: on Lite every strategy stayed within ±5%, because STT and TTS are about 90% of the cost.';
  } else {
    verdict = 'saves';
    evidence = (split
      ? 'Measured on Cascade Pro with a 32k–64k prompt: compacting at each handoff saved 26.9–37.3% with 4 stages and 39.6–51.5% with 8, against the same split without it; 27.9% on the Pro walkthrough and 27% with splitting on Standard.'
      : 'Measured on Cascade Pro with a 32k–64k prompt: compacting every 8 turns saved 8.2% on 5-minute calls and 19.7% on 10-minute calls; periodic summaries alone saved 9.5% on the Pro walkthrough.')
      + ' This model is 4.3–8.4 points more optimistic than those measurements.';
  }
  return {id: 'compaction', title: split ? 'Compact the history at each handoff' : `Compact the history every ${int(p.compactEveryTurns)} caller turns, keeping the last 2`,
    active: p.summarise, with: {summarise: true}, without: {summarise: false}, verdict, evidence,
    how: split ? 'At each handoff, replace the finished stage with a short summary of the answers it collected.'
      : `Every ${int(p.compactEveryTurns)} caller turns, replace the older turns with a short summary and keep the last 2 as they are.`,
    note: 'A small text model writes each summary (about 800 tokens in, 160 out); its price is in Model output.'};
}

// The walk works the cache out response by response; only the Cascade fallback (requests that measured as falling
// back to the system prompt or missing) can be priced away.
function cacheTip(p, scheme) {
  const how = 'Put the system prompt first, word for word the same in every node, and never write changing values (turn counters, times, live data) into the instructions during the call.';
  if (!cascade(scheme) || !p.cascadeCacheFallback) return null;
  return {id: 'cache', title: 'Keep every Cascade request on a warm cache', active: false,
    with: {cascadeCacheFallback: false}, without: {cascadeCacheFallback: true}, verdict: 'model',
    evidence: 'Measured on Cascade: 20% of requests with one prompt fell back to the cached system prompt and 2.3% missed entirely (40% and 4.5% with handoffs). This prices every request as a full hit; no change has yet been shown to get there.',
    how};
}

function toolTip(p) {
  if (p.toolCallsPerMinute === 0) return null;
  return {id: 'tools', title: 'Call tools (MCP) half as often', active: false, with: {toolCallsPerMinute: p.toolCallsPerMinute / 2},
    without: {toolCallsPerMinute: p.toolCallsPerMinute}, verdict: 'model',
    evidence: 'Not measured. Each call is one more response that sends the whole conversation again, writes its arguments as output and leaves its result in the history.',
    how: 'Combine lookups into one call and return only the fields the agent needs.'};
}

// Only managed options: a BYOM price leaves the model out, so switching to BYOM is not a like-for-like saving.
function optionTips(p, scheme) {
  const price = item => cpm(priceCall(p, item));
  const cheapest = list => list.reduce((best, item) => (price(item) < price(best) ? item : best));
  if (scheme.hosting === 'byom') return [];
  const picks = [cheapest(SCHEMES.filter(item => item.hosting === 'managed'))];
  if (scheme.mode === 'realtime') picks.unshift(cheapest(SCHEMES.filter(item => item.mode === 'realtime')));
  return [...new Map(picks.map(item => [item.id, item])).values()].filter(item => item.id !== scheme.id).map(item => ({
    id: `option:${item.id}`, title: `Switch to ${item.name} (${item.tier})`, active: false, option: item.id, verdict: 'model',
    evidence: item.mode === scheme.mode ? 'Same pipeline, different model or hosting: check answer quality and latency on your calls.'
      : 'Different pipeline: STT in front of a text model hears the caller as text; check quality and latency on your calls.',
    how: `${item.pipeline} · ${item.subtitle}`}));
}

// Tips with the price per minute with and without the change: changes to this option first, then other
// options, each group largest saving first. all: keep the changes that do not save in the model too.
export function savingsTips(params, scheme, {all = false} = {}) {
  const current = priceCall(params, scheme);
  const p = current.params;
  const base = cpm(current);
  const tips = [handoffTip(p, scheme), splitCompactTip(p, scheme), compactionTip(p, scheme), cacheTip(p, scheme), toolTip(p),
    ...optionTips(p, scheme)].filter(Boolean);
  return tips.map(tip => {
    const withPrice = tip.option ? cpm(priceCall(p, SCHEMES.find(item => item.id === tip.option))) : cpm(priceCall({...p, ...tip.with}, scheme));
    const withoutPrice = tip.option ? base : cpm(priceCall({...p, ...tip.without}, scheme));
    // Already applied: show what it saves now. Not applied: what applying it would save from here.
    const delta = tip.active ? withPrice - withoutPrice : withPrice - base;
    return {...tip, current: base, after: tip.active ? base : withPrice, delta, share: delta / (tip.active ? withoutPrice : base)};
  }).filter(tip => all || tip.delta < -0.005).sort((a, b) => Boolean(a.option) - Boolean(b.option) || a.delta - b.delta);
}
