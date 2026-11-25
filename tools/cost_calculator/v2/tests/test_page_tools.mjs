import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {DEFAULTS} from '../web/inputs.mjs';
import {ARGUMENTS, PAGE_TOOLS, PageTools} from '../web/page-tools.mjs';
import {settingsFromQuery} from '../web/share.mjs';
import {MODELS} from '../web/rate-card.mjs';

const schemas = JSON.parse(readFileSync(new URL('../agent/tools.json', import.meta.url), 'utf8'));
const schema = name => schemas.find(tool => tool.name === name).parameters;

// A page adapter that records what the page was asked to do.
function fakePage() {
  const page = {option: 'gpt-realtime-2.1@managed', params: {...DEFAULTS}, current: null, calls: []};
  const adapter = {
    state: () => ({option: page.option, params: page.params, walkthrough: page.current}),
    apply: (option, params, changed) => { Object.assign(page, {option, params}); page.calls.push(['apply', changed]); },
    walkthrough: order => { page.current = {order, shown: []}; page.calls.push(['walkthrough']); },
    node: id => { page.current?.shown.push(id); page.calls.push(['node', id]); },
    concept: name => page.calls.push(['concept', name]),
    result: () => page.calls.push(['result']),
    compare: ids => { page.calls.push(['compare', ids]); return ids.map(option => ({option})); },
    savings: () => page.calls.push(['savings']),
  };
  return {page, tools: new PageTools(adapter)};
}

test('the schemas declare exactly the page functions, models and inputs the page supports', () => {
  assert.deepEqual(new Set(schemas.map(tool => tool.name)), PAGE_TOOLS);
  assert.deepEqual(schema('set_parameters').properties.model.enum, MODELS.map(model => model.id));
  assert.deepEqual(Object.keys(schema('set_parameters').properties).filter(key => !['model', 'hosting'].includes(key)).sort(), Object.keys(ARGUMENTS).sort());
  for (const tool of schemas) assert.equal(tool.parameters.additionalProperties, false, tool.name);
});

test('set_parameters changes only the given inputs and reports the new price', () => {
  const {page, tools} = fakePage();
  const result = tools.execute('set_parameters', {minutes: 30});
  assert.equal(result.price.per_minute, '6.84 cents a minute');
  assert.equal(result.change, 'up from 6.15 cents a minute to 6.84 cents a minute');
  assert.equal(page.params.minutes, 30);
  assert.equal('cacheHitPercent' in page.params, false);
});

test('compaction sits with the prompt design, and there is no formula to switch', () => {
  const {page, tools} = fakePage();
  const compacted = tools.execute('set_parameters', {prompt_design: 'stage', compaction: true});
  assert.equal(compacted.price.per_minute, '5.93 cents a minute');
  assert.equal(compacted.inputs.compaction, true);
  assert.equal(page.params.summarise, true);
  for (const args of [{formula: 'spreadsheet'}, {cache_hit_percent: 90}, {summary_removed_percent: 20}, {keep_audio_turns: 6}])
    assert.equal(fakePage().tools.execute('set_parameters', args).error.code, 'unknown_input', JSON.stringify(args));
  assert.equal('formula' in fakePage().tools.execute('get_calculator_state', {}), false);
});

test('the option is a model and a hosting the model supports', () => {
  const {page, tools} = fakePage();
  assert.equal(tools.execute('set_parameters', {model: 'gpt-4.1'}).option, 'GPT-4.1 (Pro tier)');
  assert.equal(page.option, 'gpt-4.1@managed');
  tools.execute('set_parameters', {hosting: 'byom'});
  assert.equal(page.option, 'gpt-4.1@byom');
  assert.equal(tools.execute('set_parameters', {hosting: 'ptu'}).ok, false); // PTU is how a BYOM deployment is paid, not a hosting
  const byom = tools.execute('set_parameters', {model: 'gpt-6-luna', hosting: 'byom'}).price;
  assert.match(byom.per_minute, / cents a minute, plus the model on your deployment$/);
  assert.match(byom.not_included, /not priced here/);
  tools.execute('set_parameters', {model: 'gpt-4.1-mini'});
  assert.equal(page.option, 'gpt-4.1-mini@byom'); // the hosting is kept when the model supports it
  tools.execute('set_parameters', {hosting: 'managed'});
  assert.equal(page.option, 'gpt-4.1-mini@managed');
  assert.equal(tools.execute('set_parameters', {model: 'gpt-9'}).error.code, 'unknown_model');
});

test('invalid inputs are refused without touching the page', () => {
  const {page, tools} = fakePage();
  for (const args of [{minutes: 0}, {cache_hit_percent: 120}, {colour: 'red'}, {}, {caller_talk_percent: 80}, {prompt_design: 'long'},
    {replies_per_minute: 0, tool_calls_per_minute: 0}, {stages: 0}, {formula: 'excel'}, {compaction: 'yes'}]) {
    assert.equal(tools.execute('set_parameters', args).ok, false, JSON.stringify(args));
  }
  assert.equal(page.calls.length, 0);
  assert.equal(tools.execute('delete_everything', {}).error.code, 'unsupported_tool');
});

test('the walkthrough starts with the price per minute and every node is explained in cents per minute', () => {
  const {page, tools} = fakePage();
  const started = tools.execute('start_walkthrough', {});
  assert.equal(started.price_per_minute, '6.15 cents a minute');
  assert.equal(started.script[0], 'The price is 6.15 cents a minute. This is what one minute of the call costs at list price, the sum of the lines below, each worked out per minute.');
  assert.deepEqual(page.current.order.map(item => item.marker), ['6.15', '3.35', 'instructions first', '1.94', '1.30', '0.936', '0.561']);
  const line = tools.execute('show_cost_node', {node_id: 'price.model_input.uncached'});
  assert.equal(line.value, '1.94 ¢/min');
  assert.equal(line.share_of_price, '31.5%');
  assert.deepEqual(line.parts.map(part => part.label), ['Audio', 'Text']);
  // A product is a leaf: it lists its factors as numbers, not as parts to open.
  const leaf = tools.execute('show_cost_node', {node_id: 'price.model_input.uncached.audio.rounding'});
  assert.equal(leaf.parts, undefined);
  assert.deepEqual(leaf.factors.map(factor => factor.label), ['Uncached tokens', 'Audio input rate']);
  const mcp = tools.execute('show_cost_node', {node_id: 'price.model_output.tools'});
  assert.equal(mcp.value, '0.156 ¢/min');
  assert.match(mcp.say, /^Tool calls: 0\.156 cents a minute, 2\.5% of the price\./);
  assert.equal(tools.execute('show_cost_node', {node_id: 'price'}).share_of_price, undefined);
  assert.equal(tools.execute('show_cost_node', {node_id: 'price.nope'}).error.code, 'unknown_node');
  assert.equal(tools.execute('show_concept', {concept: 'handoff'}).title, 'What a handoff does');
  assert.equal(tools.execute('show_concept', {concept: 'magic'}).error.code, 'unknown_concept');
});

test('show_result and compare_options return what the page shows', () => {
  const {tools} = fakePage();
  const result = tools.execute('show_result', {});
  assert.equal(result.per_call, '$0.9225');
  assert.equal('formula' in result, false);
  assert.equal(result.largest_lines[0].line, 'Model input');
  const compared = tools.execute('compare_options', {});
  assert.ok(compared.cheapest_first.length >= 4 && compared.cheapest_first.length <= 7, compared.cheapest_first.length);
  assert.equal(tools.execute('compare_options', {option_ids: ['gpt-realtime-2.1@managed', 'nope']}).ok, false);
});

test('ways to pay less come from the cost advisor: the page passes its settings as a share link', () => {
  const {tools} = fakePage();
  // The page's own tips list changes measured to cost more first, so the guide does not get them.
  assert.equal(tools.execute('show_savings', {}).error.code, 'unsupported_tool');
  const state = tools.execute('get_calculator_state', {});
  const back = settingsFromQuery(state.share_link, 'gpt-6-luna@managed');
  assert.deepEqual(back.ignored, []);
  assert.equal(back.option, `${state.inputs.model}@${state.inputs.hosting}`);
  const changed = tools.execute('set_parameters', {minutes: 30, compaction: true});
  const after = settingsFromQuery(changed.share_link, 'gpt-6-luna@managed');
  assert.equal(after.params.minutes, 30);
  assert.equal(after.params.summarise, true);
});
