import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {callDrivers} from '../web/inputs.mjs';
import {priceCall, walkProfile} from '../web/pricing.mjs';
import {BYO_SPEECH, SCHEMES, schemeById} from '../web/rate-card.mjs';
import {price, simulate} from '../web/response-model.mjs';

const golden = JSON.parse(readFileSync(new URL('./response_golden.json', import.meta.url), 'utf8'));
const close = (actual, expected, label) => assert.ok(
  Math.abs(actual - expected) <= 1e-12 || Math.abs(actual - expected) / Math.abs(expected) < 1e-9, `${label}: ${actual} vs ${expected}`);
const parts = b => [b.speechIn, b.speechOut, ...Object.values(b.firstTime), ...Object.values(b.miss), ...Object.values(b.cached),
  ...Object.values(b.output)].reduce((sum, part) => sum + part.usd, 0) + b.summaries.usd;

test('with the Python fill order the JavaScript walk matches the Python reference model on all golden cases', () => {
  assert.equal(golden.cases.length, 46);
  for (const [index, item] of golden.cases.entries()) {
    const t = simulate({...item.profile, audioFirst: false, warmFirst: true, schedule: 'even'});
    for (const key of ['cachedTxt', 'uncTxt', 'cachedAud', 'uncAud', 'outTxt', 'compactions', 'busts', 'responses', 'userS', 'agentS'])
      close(t[key], item.totals[key], `case ${index} ${key}`);
    for (const [tier, expected] of Object.entries(item.prices)) {
      const actual = price(t, golden.tiers[tier]);
      for (const key of ['input', 'llm', 'fixedSpeech', 'summary', 'total']) close(actual[key], expected[key], `case ${index} ${tier} ${key}`);
    }
  }
});

test('the page inputs map onto the Python reference grid', () => {
  const tiers = {realtime: [['rt21-pro', 'rt_pro']], cascade: [['pro-speech', 'casc_pro'], ['std-speech', 'casc_std'], ['lite-speech', 'casc_lite']]};
  let checked = 0;
  for (const item of golden.cases.slice(0, 36)) {
    const {pipeline, minutes, nodes, strategy} = item.profile;
    if (strategy === 's2' || (strategy === 'periodic' && nodes > 1)) continue; // not offered on the page
    const params = {minutes, promptDesign: nodes > 1 ? 'stage' : 'single', summarise: strategy !== 'none'};
    for (const [id, tier] of tiers[pipeline]) {
      const walk = simulate({...walkProfile(callDrivers(params, schemeById(id))), audioFirst: false, warmFirst: true, schedule: 'even', periodicEvery: 8});
      close(price(walk, golden.tiers[tier]).total, item.prices[tier].total, `${id} ${JSON.stringify(params)}`);
      checked++;
    }
  }
  assert.equal(checked, 48); // 12 page-shaped profiles per pipeline; realtime on 1 tier, Cascade on 3
});

test('there is one way to price a call: the inputs of the old spreadsheet formula are refused', () => {
  for (const params of [{formula: 'spreadsheet'}, {formula: 'measured'}, {cacheHitPercent: 70}, {summaryRemovedPercent: 20}, {keepAudioTurns: 6}])
    assert.throws(() => priceCall(params, schemeById('rt21-pro')), /Unknown inputs/, JSON.stringify(params));
  assert.equal(priceCall({}, schemeById('rt21-pro')).formula, undefined);
});

test('the billed parts add up to the price', () => {
  for (const scheme of SCHEMES)
    for (const params of [{}, {minutes: 30}, {promptDesign: 'stage'}, {promptDesign: 'stage', summarise: true}, {summarise: true},
      {reasoningTokens: 50, minutes: 7}, {cascadeCacheFallback: false}, {toolCallsPerMinute: 0}]) {
      const q = priceCall(params, scheme);
      close(parts(q.breakdown), q.perCall, `${scheme.id} ${JSON.stringify(params)} parts`);
      close(q.lines.reduce((sum, line) => sum + line.value, 0), q.perCall, `${scheme.id} lines`);
    }
});

test('the page defaults: one prompt, all history kept', () => {
  const cpm = (id, params = {}) => (priceCall(params, schemeById(id)).perMinute * 100).toFixed(2);
  // Realtime with caller audio filled first and the first request cold; no cache hit rate goes in.
  assert.equal(cpm('rt21-pro'), '6.15');
  assert.equal(cpm('rt21-pro', {promptDesign: 'stage'}), '7.46');
  assert.equal(cpm('rt21-pro', {promptDesign: 'stage', summarise: true}), '5.93');
  assert.equal(cpm('pro-speech'), '5.34');
  assert.equal(cpm('pro-speech', {cascadeCacheFallback: false}), '4.16');
  // Handoffs fall where a real graph routes: 5 nodes = 2 routing nodes first, an if-else branch the call does not
  // take, the main node and one end node, so the long history is handed off once, at the end. Logic follows the
  // responses, the branch counted like a routing node: 4,000 × 2 / 47 = 170.
  const staged = priceCall({promptDesign: 'stage'}, schemeById('rt21-pro')).breakdown.walk;
  assert.equal(staged.handoffs, 3);
  assert.deepEqual(staged.trace.flatMap((row, index) => (row.handoffCall ? [index] : [])), [2, 5, 45]);
  const plan = priceCall({promptDesign: 'stage'}, schemeById('rt21-pro')).plan;
  assert.deepEqual(plan.map(node => [node.role, node.length, node.logic]),
    [['routing', 2, 170], ['routing', 2, 170], ['branch', 0, 170], ['main', 39, 3319], ['end', 2, 170]]);
  // From 6 running nodes up there are two main nodes; all nodes together still hold the whole business logic.
  const eight = priceCall({promptDesign: 'stage', stages: 8}, schemeById('rt21-pro')).plan;
  assert.deepEqual(eight.map(node => node.role), ['routing', 'routing', 'routing', 'routing', 'branch', 'main', 'main', 'end']);
  assert.ok(Math.abs(eight.reduce((total, node) => total + node.logic, 0) - 4000) <= 8);
  // The first request is cold: its 6,000 instruction tokens are sent for the first time, at the full rate.
  const first = priceCall({}, schemeById('rt21-pro')).breakdown.walk.trace[0];
  assert.equal(first.instructions, 6000);
  assert.equal(first.cachedInstructions, 0);
  const q = priceCall({}, schemeById('rt21-pro'));
  assert.deepEqual(q.lines.map(line => line.label), ['STT', 'TTS', 'Model input', 'Model output']);
  // Realtime hears the caller itself (model input), and STT runs beside it so barge-in works: the Pro tier STT rate.
  close(q.lines[0].value, q.breakdown.walk.callerAudioTokens * 17 / 1e6, 'realtime STT for barge-in');
  assert.equal(q.breakdown.summaries.count, 0);
  // One summary per handoff: 2 routing switches at the start and 1 into the end node.
  assert.equal(priceCall({promptDesign: 'stage', summarise: true}, schemeById('rt21-pro')).breakdown.summaries.count, 3);
});

test('BYOM prices only what the voice agent bills: STT and TTS at the BYO rate, the same for every model', () => {
  const q = priceCall({}, schemeById('luna6-byom'));
  assert.deepEqual(q.lines.map(line => line.label), ['STT', 'TTS']);
  assert.equal(q.modelOnDeployment, true);
  assert.equal(q.extra, 'model on your deployment');
  const t = q.breakdown.walk;
  close(q.perCall, (t.callerAudioTokens * BYO_SPEECH.audioInput + t.agentAudioTokens * BYO_SPEECH.audioOutput) / 1e6, 'speech only');
  // A BYOM session always transcribes the caller, so a realtime model has STT too and the same price.
  const realtime = priceCall({}, schemeById('gpt-realtime-2.1@byom'));
  assert.ok(realtime.lines[0].value > 0);
  close(realtime.perCall, q.perCall, 'same for every model');
  // Summaries are model tokens: not billed on BYOM.
  assert.equal(priceCall({promptDesign: 'stage', summarise: true}, schemeById('luna6-byom')).breakdown.summaries.usd, 0);
  // PTU is how a customer may pay for their own deployment, not a hosting the page prices.
  assert.ok(!SCHEMES.some(scheme => scheme.hosting !== 'managed' && scheme.hosting !== 'byom'));
  assert.equal(priceCall({}, schemeById('lite-speech')).extra, null);
});
