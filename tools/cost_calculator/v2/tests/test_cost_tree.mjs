import assert from 'node:assert/strict';
import test from 'node:test';
import {priceCall} from '../web/pricing.mjs';
import {SCHEMES, schemeById} from '../web/rate-card.mjs';
import {allNodes, buildCostTree, findNode, narrationOrder} from '../web/cost-tree.mjs';

const close = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), `${label}: ${actual} vs ${expected}`);
// The page defaults (one prompt, all history kept) and the knobs that change the walk.
const CASES = [{}, {minutes: 1}, {minutes: 10}, {minutes: 30}, {minutes: 60}, {promptDesign: 'stage'}, {promptDesign: 'stage', summarise: true},
  {summarise: true}, {reasoningTokens: 50}, {toolCallsPerMinute: 0}, {cascadeCacheFallback: false}, {logicTokens: 14000, promptDesign: 'stage'}];
const build = (id, params = {}) => {
  const scheme = schemeById(id);
  const priced = priceCall(params, scheme);
  return {priced, root: buildCostTree(priced, scheme)};
};
const tag = (scheme, params) => `${scheme.id} ${JSON.stringify(params)}`;

test('the root is the price per minute and each line is its cost line divided by the call length', () => {
  for (const scheme of SCHEMES) for (const params of CASES) {
    const {priced, root} = build(scheme.id, params);
    close(root.value, priced.perMinute * 100, `${tag(scheme, params)} root`);
    assert.equal(root.children.length, priced.lines.length, tag(scheme, params));
    priced.lines.forEach((line, i) => close(root.children[i].value, line.value / priced.params.minutes * 100, `${tag(scheme, params)} ${line.key}`));
  }
});

test('every cost is in cents per minute and every node adds up or multiplies out', () => {
  for (const scheme of SCHEMES) for (const params of CASES) {
    const {root} = build(scheme.id, params);
    const ids = new Set();
    for (const node of allNodes(root)) {
      const where = `${tag(scheme, params)} ${node.id}`;
      assert.ok(!ids.has(node.id), `duplicate ${where}`);
      ids.add(node.id);
      if (node.kind === 'cost') assert.match(node.display, / ¢\/min$/, where);
      if (node.op === 'sum') close(node.children.reduce((total, child) => total + child.value, 0), node.value, where);
      if (node.op === 'product') close(node.children.reduce((total, child) => total * child.value, node.scale), node.value, where);
      for (const key of ['label', 'display', 'explain', 'visual']) assert.ok(node[key], `${where} ${key}`);
      assert.ok(!/NaN|undefined|Infinity/.test([node.display, node.numbers ?? '', node.formula ?? '', node.explain].join(' ')), where);
    }
  }
});

test('realtime: STT runs beside the model for barge-in, model input splits into uncached and cached, each into audio and text', () => {
  const {root} = build('rt21-pro');
  assert.equal(root.display, '6.15 ¢/min');
  assert.deepEqual(root.children.map(line => line.key), ['stt', 'tts', 'model_input', 'model_output']);
  assert.equal(findNode(root, 'price.stt').display, '0.561 ¢/min'); // the Pro tier STT rate, as on Cascade Pro
  assert.equal(findNode(root, 'price.model_input').display, '3.35 ¢/min');
  assert.deepEqual(findNode(root, 'price.model_input').children.map(part => part.label), ['Uncached input', 'Cached input']);
  assert.deepEqual(findNode(root, 'price.model_input.uncached').children.map(part => part.label), ['Audio', 'Text']);
  assert.deepEqual(findNode(root, 'price.model_input.uncached.text').children.map(part => part.label), ['Instructions', 'New reply', 'New audio framing', 'Cache rounding']);
  assert.deepEqual(findNode(root, 'price.model_input.uncached.audio').children.map(part => part.label), ['New audio', 'Cache rounding']);
  assert.equal(findNode(root, 'price.model_input.uncached.audio.new').numbers, '330 tokens/min × $32 / 1M tokens');
  assert.equal(findNode(root, 'price.model_input.uncached.audio.rounding').display, '0.516 ¢/min');
  assert.equal(findNode(root, 'price.model_input.cached.audio').display, '0.284 ¢/min');
});

test('speech options hear the caller once, BYOM has only STT and TTS', () => {
  const speech = build('pro-speech').root;
  assert.equal(findNode(speech, 'price.stt').display, '0.561 ¢/min');
  assert.equal(findNode(speech, 'price.model_input.cached.audio'), null);
  assert.equal(findNode(speech, 'price.model_input.uncached.audio'), null);
  // A text model takes no audio, so the parts sit directly under uncached input.
  assert.deepEqual(findNode(speech, 'price.model_input.uncached').children.map(part => part.key), ['instructions', 'reply', 'new', 'rounding', 'fallback']);
  const byom = build('luna6-byom').root;
  assert.equal(byom.label, 'Voice-agent cost per minute');
  assert.deepEqual(byom.children.map(line => line.key), ['stt', 'tts']);
  assert.equal(findNode(byom, 'price.stt.stt_rate').value, 12.5);
  assert.equal(findNode(byom, 'price.tts.voice_rate').value, 23);
  assert.match(byom.explain, /not included/);
});

test('a split prompt with compaction adds the handoff calls and the summaries to the model output', () => {
  const plain = build('rt21-pro', {promptDesign: 'stage'}).root;
  const compacted = build('rt21-pro', {promptDesign: 'stage', summarise: true}).root;
  assert.equal(compacted.display, '5.93 ¢/min');
  assert.ok(compacted.value < plain.value);
  const output = findNode(compacted, 'price.model_output');
  assert.ok(output.children.some(child => child.key === 'summaries'), output.children.map(child => child.key).join(', '));
  assert.ok(!findNode(build('rt21-pro').root, 'price.model_output').children.some(child => child.key === 'summaries'));
});

test('the per-response rows the diagrams draw add up to the walk that sets the price', () => {
  for (const id of ['rt21-pro', 'pro-speech', 'lite-speech']) for (const params of CASES.slice(0, 11)) {
    const walk = priceCall(params, schemeById(id)).breakdown.walk;
    const sum = key => walk.trace.reduce((total, row) => total + row[key], 0);
    assert.equal(walk.trace.length, walk.responses, `${id} ${JSON.stringify(params)}`);
    close(sum('cachedInstructions'), walk.cachedStatic, `${id} cached instructions`);
    close(sum('instructions') - sum('cachedInstructions'), walk.uncStatic, `${id} missed instructions`);
    close(sum('cachedText'), walk.cachedHistTxt, `${id} cached text`);
    close(sum('historyText') - sum('cachedText'), walk.uncHistTxt, `${id} missed text`);
    close(sum('cachedAudio'), walk.cachedHistAud, `${id} cached audio`);
    close(sum('historyAudio') - sum('cachedAudio'), walk.uncHistAud, `${id} missed audio`);
  }
});

test('the narration starts with the price and goes down the largest lines', () => {
  const {root} = build('rt21-pro');
  const order = narrationOrder(root);
  assert.deepEqual(order.slice(0, 3), ['price', 'price.model_input', 'price.model_input.uncached']);
  for (const id of order) assert.ok(findNode(root, id), id);
});

test('uncached input lists why each token pays the full rate, adding up exactly to what the walk prices', () => {
  for (const scheme of SCHEMES) for (const params of CASES) {
    const {priced, root} = build(scheme.id, params);
    if (priced.modelOnDeployment) continue;
    const b = priced.breakdown, usd = group => Object.values(group).reduce((total, part) => total + part.usd, 0);
    close(usd(b.missBy), usd(b.miss), `${tag(scheme, params)} uncached by why = uncached by kind`);
    const uncached = findNode(root, 'price.model_input.uncached');
    close(uncached.value, (usd(b.missBy) + usd(b.firstTime)) / priced.params.minutes * 100, `${tag(scheme, params)} uncached node`);
    // History is what was sent before and cached; it never appears as a reason to pay the full rate.
    assert.ok(!allNodes(uncached).some(node => node.label === 'History'), tag(scheme, params));
  }
});
