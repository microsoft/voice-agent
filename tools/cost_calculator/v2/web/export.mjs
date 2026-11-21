// The calculation as an Excel workbook, the same numbers as the page:
//   Cost       the cost tree with live formulas: a product row is tokens/min × rate ÷ 10,000 (¢/min), a sum row adds
//              its parts, cost per call is ¢/min × call length ÷ 100; then the bill
//   Settings   every input, its default, and the link that opens these settings
//   Nodes      a split prompt's nodes: role, the responses each handles and its business logic
//   Responses  the walk, response by response: what each request sends and how much of it the cache covers
import {DEFAULTS} from './inputs.mjs';
import {PRESETS, RATES_AS_OF} from './rate-card.mjs';
import {STYLES as S, workbook} from './xlsx.mjs';

const bold = v => ({v, style: S.bold});
const costParts = n => (n.op === 'sum' && n.kind === 'cost' ? n.children : []);

function costSheet({tree, result, scheme, params, url}) {
  const T = params.minutes;
  const rows = [
    [bold('Voice-agent cost, worked out per minute')],
    ['Option', `${scheme.name} · ${scheme.tier} · ${scheme.hosting}`],
    ['Call length, minutes', T],
    ['Link to these settings', url],
    ['Rates as of', RATES_AS_OF],
    [],
    ['Cost line', 'Tokens / min', 'Rate, USD / 1M tokens', 'Cost, ¢ / min', 'Cost, USD / call', 'What it is'].map(bold),
  ];
  const flat = [];
  const walk = (n, depth) => { flat.push({n, depth}); costParts(n).forEach(child => walk(child, depth + 1)); };
  walk(tree, 0);
  const first = rows.length + 1;
  const rowOf = new Map(flat.map(({n}, i) => [n, first + i]));
  for (const {n, depth} of flat) {
    const r = rowOf.get(n), parts = costParts(n);
    const sumOf = letter => `SUM(${parts.map(part => `${letter}${rowOf.get(part)}`).join(',')})`;
    const tokens = n.tokensPerMinute == null ? ''
      : parts.length && parts.every(part => part.tokensPerMinute != null) ? {f: sumOf('B'), v: n.tokensPerMinute, style: S.tokens}
      : {v: n.tokensPerMinute, style: S.tokens};
    const rate = n.usdPerM == null ? '' : {v: n.usdPerM, style: S.rate};
    const cost = parts.length ? {f: sumOf('D'), v: n.value, style: S.cents}
      : n.tokensPerMinute != null && n.usdPerM != null ? {f: `B${r}*C${r}/10000`, v: n.value, style: S.cents}
      : {v: n.value, style: S.cents};
    rows.push([{v: `${'    '.repeat(depth)}${n.label}`, style: depth ? S.plain : S.bold}, tokens, rate, cost,
      {f: `D${r}*$B$3/100`, v: n.value * T / 100, style: S.usd}, parts.length ? n.formula ?? '' : (n.explain ?? '').split('. ')[0]]);
  }
  const at = rows.length + 2;
  rows.push([], [bold('The bill')],
    ['Price per minute, ¢', {f: `D${first}`, v: tree.value, style: S.cents}],
    ['Price per call, USD', {f: `E${first}`, v: result.perCall, style: S.usd}],
    ['Calls per month', params.monthlyCalls],
    ['Price per month, USD', {f: `B${at + 2}*B${at + 3}`, v: result.monthly, style: S.usd}]);
  if (result.extra) rows.push(['Not included', `${result.extra}: the model is billed on your own deployment`]);
  return {name: 'Cost', rows, widths: [34, 14, 20, 14, 16, 90]};
}

function settingsSheet(option, params, url) {
  const text = value => (typeof value === 'boolean' ? String(value) : value);
  return {name: 'Settings', widths: [30, 34, 34], rows: [
    ['Input', 'Value', 'Default'].map(bold),
    ['option', option, PRESETS[0]],
    ...Object.keys(DEFAULTS).map(key => [key, text(params[key]), text(DEFAULTS[key])]),
    [],
    ['Link to these settings', url],
  ]};
}

function nodesSheet(plan) {
  const rows = [['Node', 'Role', 'First response', 'Last response', 'Responses', 'Business logic tokens'].map(bold)];
  plan.forEach((node, i) => rows.push([i + 1, node.role === 'branch' ? 'if-else branch, not taken' : node.role,
    node.length ? node.start + 1 : '', node.length ? node.start + node.length : '', node.length, node.logic]));
  rows.push(['Total', '', '', '', {f: `SUM(E2:E${plan.length + 1})`, v: plan.reduce((t, n) => t + n.length, 0)},
    {f: `SUM(F2:F${plan.length + 1})`, v: plan.reduce((t, n) => t + n.logic, 0)}]);
  return {name: 'Nodes', rows, widths: [8, 26, 16, 16, 12, 22]};
}

function responsesSheet(trace) {
  const round = value => Math.round(value * 100) / 100;
  return {name: 'Responses', widths: [11, 7, 13, 13, 13, 19, 13, 20, 14, 21], rows: [
    ['Response', 'Node', 'Handoff call', 'Cache break', 'Instructions', 'Cached instructions', 'History text', 'Cached history text',
      'History audio', 'Cached history audio'].map(bold),
    ...trace.map((row, i) => [i + 1, row.node + 1, row.handoffCall ? 'yes' : '', row.bust, round(row.instructions), round(row.cachedInstructions),
      round(row.historyText), round(row.cachedText), round(row.historyAudio), round(row.cachedAudio)]),
  ]};
}

export function costWorkbook({tree, result, scheme, option, params, url}) {
  const sheets = [costSheet({tree, result, scheme, params, url}), settingsSheet(option, params, url)];
  if (result.plan) sheets.push(nodesSheet(result.plan));
  if (!result.modelOnDeployment) sheets.push(responsesSheet(result.breakdown.walk.trace));
  return workbook(sheets);
}

export const exportFileName = (option, params) => `voice-agent-cost_${option.replace(/[^a-z0-9.-]+/gi, '-')}_${params.minutes}min.xlsx`;
