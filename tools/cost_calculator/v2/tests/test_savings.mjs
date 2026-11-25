import assert from 'node:assert/strict';
import test from 'node:test';
import {priceCall} from '../web/pricing.mjs';
import {SCHEMES, schemeById} from '../web/rate-card.mjs';
import {savingsTips} from '../web/savings.mjs';

const tips = (id, params = {}, all = false) => savingsTips(params, schemeById(id), {all});
const tip = (id, params, name) => tips(id, params, true).find(item => item.id === name);
const cpm = (id, params) => priceCall(params, schemeById(id)).perMinute * 100;

test('compaction already on shows what it saves now; off shows what turning it on would save', () => {
  const split = {promptDesign: 'stage'}, on = {...split, summarise: true};
  const saving = cpm('rt21-pro', on) - cpm('rt21-pro', split);
  assert.ok(saving < 0);
  const active = tip('rt21-pro', on, 'compaction');
  assert.equal(active.active, true);
  assert.ok(Math.abs(active.delta - saving) < 1e-12);
  const off = tip('rt21-pro', split, 'compaction');
  assert.equal(off.active, false);
  assert.ok(Math.abs(off.delta - saving) < 1e-12);
  assert.equal(off.title, 'Compact the history at each handoff');
  assert.equal(tip('rt21-pro', {}, 'compaction').title, 'Compact the history every 10 caller turns, keeping the last 2');
});

test('the verdicts follow the measured conditions', () => {
  assert.equal(tip('rt21-pro', {}, 'handoff').verdict, 'costs-more');
  assert.equal(tip('rt21-pro', {logicTokens: 9000}, 'handoff').verdict, 'depends');
  assert.equal(tip('rt21-pro', {logicTokens: 14000}, 'handoff').verdict, 'saves');
  const huge = tip('rt21-pro', {logicTokens: 20000}, 'handoff');
  assert.equal(huge.verdict, 'saves');
  assert.match(huge.evidence, /^Required: one realtime node accepts at most 16,384/);
  assert.equal(tip('rt21-pro', {promptDesign: 'stage'}, 'compaction').verdict, 'saves');
  const periodic = tip('rt21-pro', {}, 'compaction');
  assert.equal(periodic.verdict, 'costs-more');
  assert.match(periodic.evidence, /more optimistic than those calls/);
  assert.equal(tip('rt21-pro', {minutes: 25}, 'compaction').verdict, 'depends');
  assert.equal(tip('pro-speech', {}, 'compaction').verdict, 'saves');
  assert.match(tip('pro-speech', {}, 'compaction').evidence, /4\.3–8\.4 points more optimistic/);
  assert.equal(tip('pro-speech', {}, 'handoff').verdict, 'depends');
  assert.equal(tip('lite-speech', {}, 'compaction').verdict, 'depends');
  assert.equal(tip('luna6-byom', {}, 'compaction').verdict, 'model');
});

test('from one prompt the combined tip splits by stage and compacts at each handoff', () => {
  const combined = tip('rt21-pro', {}, 'handoff_compaction');
  assert.equal(combined.verdict, 'depends');
  assert.ok(Math.abs(combined.delta - (cpm('rt21-pro', {promptDesign: 'stage', summarise: true}) - cpm('rt21-pro', {}))) < 1e-12);
  assert.ok(combined.delta < 0);
  assert.equal(tip('rt21-pro', {logicTokens: 14000}, 'handoff_compaction').verdict, 'saves');
  assert.equal(tip('pro-speech', {}, 'handoff_compaction').verdict, 'saves');
  assert.equal(tip('rt21-pro', {promptDesign: 'stage'}, 'handoff_compaction'), undefined);
});

test('the cache tip is the Cascade fallback, the one cache cost the walk can price away', () => {
  assert.equal(tip('rt21-pro', {}, 'cache'), undefined);
  const fallback = tip('pro-speech', {}, 'cache');
  assert.equal(fallback.verdict, 'model');
  assert.ok(fallback.delta < 0);
  assert.equal(tip('pro-speech', {cascadeCacheFallback: false}, 'cache'), undefined);
});

test('the list keeps only changes that save in the model, changes to this option before other options', () => {
  for (const scheme of SCHEMES) for (const params of [{}, {promptDesign: 'stage', summarise: true}, {minutes: 30}, {logicTokens: 14000}]) {
    const list = savingsTips(params, scheme);
    assert.ok(list.every(item => item.delta < 0), scheme.id);
    const firstOption = list.findIndex(item => item.option);
    if (firstOption >= 0) assert.ok(list.slice(firstOption).every(item => item.option), scheme.id);
    for (const item of list) assert.ok(item.title && item.evidence && item.how && item.verdict, `${scheme.id} ${item.id}`);
  }
  assert.equal(tips('luna6-byom').length, 0, 'on BYOM no change moves the voice-agent cost, and BYOM is not offered as a saving');
  assert.ok(!tips('pro-speech').some(item => item.option?.endsWith('@byom')), 'BYOM leaves the model out: not a like-for-like switch');
  assert.ok(!tips('rt21-pro').some(item => item.id === 'handoff'), 'splitting a 4k prompt costs more in the measured model');
});
