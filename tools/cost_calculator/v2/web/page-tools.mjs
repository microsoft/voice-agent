// The Agent's page functions. They validate the arguments, drive the page through a small adapter
// (page.apply, page.walkthrough, page.node, page.concept, page.result, page.compare, page.savings) and return
// JSON built from the same model, cost tree and tips the page shows. Pure apart from the adapter, so Node can
// test them.
import {DEFAULTS} from './inputs.mjs';
import {priceCall} from './pricing.mjs';
import {MODELS, PRESETS, hostingsFor, schemeById} from './rate-card.mjs';
import {format} from './steps.mjs';
import {buildCostTree, findNode, narrationOrder, spokenCpm} from './cost-tree.mjs';
import {CONCEPT_TEXT} from './concepts.mjs';
import {comparisonIds} from './result.mjs';
import {settingsQuery} from './share.mjs';

const {usd, pct} = format;
export const PAGE_TOOLS = new Set(['get_calculator_state', 'set_parameters', 'start_walkthrough', 'show_cost_node', 'show_concept',
  'show_result', 'compare_options']);

// Agent argument -> model parameter. The option is chosen with model and hosting.
export const ARGUMENTS = Object.freeze({
  minutes: 'minutes', prompt_design: 'promptDesign', system_prompt_tokens: 'systemPromptTokens',
  logic_tokens: 'logicTokens', stages: 'stages', tool_calls_per_minute: 'toolCallsPerMinute', replies_per_minute: 'repliesPerMinute',
  caller_talk_percent: 'callerTalkPercent', agent_talk_percent: 'agentTalkPercent', compaction: 'summarise',
  cascade_cache_fallback: 'cascadeCacheFallback', monthly_calls: 'monthlyCalls',
  currency: 'currency', discount_percent: 'discountPercent',
});
const RANGES = {minutes: [1, 60], system_prompt_tokens: [0, 100000], logic_tokens: [0, 200000],
  stages: [1, 20], tool_calls_per_minute: [0, 10], replies_per_minute: [0, 20],
  caller_talk_percent: [0, 100], agent_talk_percent: [0, 100], monthly_calls: [1, 100000000], discount_percent: [0, 100]};

const failure = (code, message) => ({ok: false, error: {code, message}});
// BYOM prices only what the voice agent bills: every amount says the model comes on top.
const plus = r => (r.extra ? `, plus the ${r.extra}` : '');
const price = r => ({per_minute: spokenCpm(r.perMinute * 100) + plus(r), per_call: usd(r.perCall) + plus(r), per_month: usd(r.monthly, 0) + plus(r),
  ...(r.extra ? {not_included: "The model: it is billed on the customer's own deployment (pay-as-you-go or PTU) and is not priced here."} : {})});
const summary = node => ({node_id: node.id, label: node.label, value: node.display});
const firstSentence = text => (text.match(/^.+?[.!?](?=\s|$)/) ?? [text])[0];

// The walkthrough as sentences: the price first, then its largest parts, and what each request sends after
// the instructions and history line. Each sentence carries its node's number; the page opens the node when
// that number reaches the guide's transcript.
export function walkthroughScript(tree) {
  const script = [];
  for (const id of narrationOrder(tree)) {
    const node = findNode(tree, id);
    const spoken = spokenCpm(node.value);
    script.push({node_id: id, marker: node.display.split(' ')[0], say: node === tree
      ? `The price is ${spoken}. ${firstSentence(node.explain)}`
      : `${node.label}: ${spoken}, ${pct(node.value / tree.value, 1)} of the price. ${firstSentence(node.explain)}`});
    if (node.key === 'model_input') script.push({concept: 'request', marker: 'instructions first',
      say: 'Each response sends the instructions first and the whole conversation behind them, one turn more each time; what was already sent is read from the cache unless a handoff or a compaction has just changed it.'});
  }
  return script;
}

export function inputsFor(params, optionId) {
  const scheme = schemeById(optionId);
  return {model: scheme.model, hosting: scheme.hosting, ...Object.fromEntries(Object.entries(ARGUMENTS).map(([arg, key]) => [arg, params[key]]))};
}

export class PageTools {
  constructor(page) {
    this.page = page;
  }

  execute(name, args) {
    if (!PAGE_TOOLS.has(name)) return failure('unsupported_tool', 'Only the documented page functions are allowed.');
    try { return this[name](args ?? {}); }
    catch (error) { return failure('invalid_input', error.message); }
  }

  model(option, params) {
    const scheme = schemeById(option);
    const result = priceCall(params, scheme);
    return {scheme, result, tree: buildCostTree(result, scheme)};
  }

  get_calculator_state() {
    const {option, params, walkthrough} = this.page.state();
    const {scheme, result, tree} = this.model(option, params);
    return {ok: true, option: {model: scheme.model, hosting: scheme.hosting, name: scheme.name, tier: scheme.tier},
      share_link: `?${settingsQuery(option, params)}`,
      standard_options: PRESETS.map(id => schemeById(id).name),
      models: MODELS.map(model => ({id: model.id, name: model.name, hostings: hostingsFor(model.id)})),
      inputs: inputsFor(params, option), ranges: RANGES, price: price(result), cached_input_share: pct(result.cacheShare),
      cost_lines: tree.children.map(summary), walkthrough: walkthrough ? {shown: walkthrough.shown} : null};
  }

  set_parameters(args) {
    const {option: current, params} = this.page.state();
    const unknown = Object.keys(args).filter(key => !['model', 'hosting'].includes(key) && !(key in ARGUMENTS));
    if (unknown.length) return failure('unknown_input', `Unknown inputs: ${unknown.join(', ')}.`);
    if (!Object.keys(args).length) return failure('no_change', 'Pass at least one input to change.');
    for (const [key, [low, high]] of Object.entries(RANGES)) {
      if (key in args && (typeof args[key] !== 'number' || args[key] < low || args[key] > high))
        return failure('out_of_range', `${key} must be a number from ${low} to ${high}.`);
    }
    let option = current;
    if ('model' in args || 'hosting' in args) {
      const now = schemeById(current);
      const model = args.model ?? now.model;
      const hostings = hostingsFor(model);
      if (!hostings.length) return failure('unknown_model', `Unknown model ${model}. Models: ${MODELS.map(item => item.id).join(', ')}.`);
      const hosting = args.hosting ?? (hostings.includes(now.hosting) ? now.hosting : hostings[0]);
      if (!hostings.includes(hosting)) return failure('unsupported_hosting', `${model} can be priced as ${hostings.join(' or ')}.`);
      option = `${model}@${hosting}`;
    }
    const next = {...params};
    for (const [arg, key] of Object.entries(ARGUMENTS)) if (arg in args) next[key] = args[arg];
    const before = this.model(current, params).result;
    const {scheme, result} = this.model(option, next);
    const changed = Object.keys(args);
    this.page.apply(option, next, changed);
    return {ok: true, changed, option: `${scheme.name} (${scheme.tier})`, inputs: inputsFor(next, option),
      share_link: `?${settingsQuery(option, next)}`, price: price(result),
      previous_price: price(before),
      change: `${result.perMinute >= before.perMinute ? 'up' : 'down'} from ${spokenCpm(before.perMinute * 100)} to ${spokenCpm(result.perMinute * 100)}`};
  }

  start_walkthrough() {
    const {option, params} = this.page.state();
    const {scheme, result, tree} = this.model(option, params);
    const script = walkthroughScript(tree);
    this.page.walkthrough(script);
    return {ok: true, option: `${scheme.name} (${scheme.tier})`, unit: 'US cents per minute of call', price_per_minute: spokenCpm(tree.value) + plus(result),
      script: script.map(item => item.say),
      how: 'In your next reply say these sentences in this order, keeping every number exactly as written, and call no function in that reply. The page opens each part of the cost tree as you say its number and shows the bill when you finish. End with one short question.'};
  }

  show_cost_node({node_id: id}) {
    const {option, params} = this.page.state();
    const {tree} = this.model(option, params);
    const node = typeof id === 'string' ? findNode(tree, id) : null;
    if (!node) return failure('unknown_node', `Use a node_id returned by start_walkthrough or listed in a node's parts. The cost lines are ${tree.children.map(line => line.id).join(', ')}.`);
    this.page.node(id);
    const isCost = node.kind === 'cost';
    const share = isCost && tree.value && node !== tree ? pct(node.value / tree.value, 1) : null;
    const spoken = isCost ? spokenCpm(node.value) : node.display;
    return {ok: true, node_id: id, label: node.label, value: node.display, ...(share ? {share_of_price: share} : {}),
      formula: node.formula ?? null, numbers: node.numbers ?? null, explanation: node.explain,
      // A cost lists the costs it adds up from; a product lists its factors, which are not nodes to open.
      ...(node.op === 'sum' && node.kind === 'cost' ? {parts: node.children.map(summary)}
        : node.children.length ? {factors: node.children.map(factor => ({label: factor.label, value: factor.display, numbers: factor.numbers ?? null}))} : {}),
      ...(CONCEPT_TEXT[node.visual] ? {related_concept: node.visual} : {}),
      say: `${node.label}: ${spoken}${share ? `, ${share} of the price` : ''}. ${node.explain}`};
  }

  show_concept({concept}) {
    const text = CONCEPT_TEXT[concept];
    if (!text) return failure('unknown_concept', `Use one of ${Object.keys(CONCEPT_TEXT).join(', ')}.`);
    this.page.concept(concept);
    return {ok: true, concept, title: text.title, explanation: text.text};
  }

  show_result() {
    const {option, params} = this.page.state();
    const {result} = this.model(option, params);
    this.page.result();
    const lines = result.lines.filter(line => line.value > 0).sort((a, b) => b.value - a.value);
    return {ok: true, ...price(result), audio_share: pct(result.audioShare), cached_input_share: pct(result.cacheShare),
      largest_lines: lines.slice(0, 3).map(line => ({line: line.label, per_minute: spokenCpm(line.value / result.params.minutes * 100),
        share: pct(line.value / result.perCall)}))};
  }

  compare_options({option_ids: ids} = {}) {
    const {option, params} = this.page.state();
    const chosen = (ids ?? comparisonIds(params, option)).map(id => schemeById(id).id);
    const ranking = this.page.compare(chosen);
    return {ok: true, current: option, cheapest_first: ranking};
  }

}

export {DEFAULTS};
