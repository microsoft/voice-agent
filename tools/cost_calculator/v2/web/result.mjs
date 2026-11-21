// The result section: headline tiles, the cost lines of one call, every option under the same inputs,
// and the per-minute price over call length. Every number comes from priceCall(), the response-by-response walk.
import {priceCall} from './pricing.mjs';
import {BYO_SPEECH, PRESETS, SCHEMES, schemeById} from './rate-card.mjs';
import {format} from './steps.mjs';
import {cpm} from './cost-tree.mjs';
import {savingsTips} from './savings.mjs';

const {int, num, usd, rate, cents, pct} = format;
const NS = 'http://www.w3.org/2000/svg';
const tokensOf = group => Object.values(group).reduce((sum, part) => sum + part.tokens, 0);

const node = (tag, cls = '', text) => {
  const element = document.createElement(tag);
  if (cls) element.className = cls;
  if (text !== undefined) element.textContent = text;
  return element;
};
const svgNode = (parent, tag, attrs = {}) => {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  parent.append(element);
  return element;
};

// One tooltip for the page, placed next to the pointer or the focused mark.
export function attachTooltip(target, text) {
  const tip = document.getElementById('tooltip');
  const show = event => {
    tip.textContent = typeof text === 'function' ? text(event) : text;
    tip.hidden = false;
    const box = event.clientX === undefined ? target.getBoundingClientRect() : {left: event.clientX, top: event.clientY, width: 0};
    tip.style.left = `${Math.min(innerWidth - tip.offsetWidth - 12, box.left + box.width / 2 + 14)}px`;
    tip.style.top = `${Math.max(8, box.top - tip.offsetHeight - 10)}px`;
  };
  const hide = () => { tip.hidden = true; };
  target.addEventListener('pointermove', show);
  target.addEventListener('focus', show);
  target.addEventListener('pointerleave', hide);
  target.addEventListener('blur', hide);
}

export function renderTiles(container, r) {
  const local = r.local.currency !== 'USD' || r.params.discountPercent > 0;
  const tiles = [
    ['hero', r.modelOnDeployment ? 'voice-agent cost per minute' : 'per minute', cents(r.perMinute),
      local ? `${r.local.currency} ${num(r.local.perMinute, 2)} after discount` : 'USD list price'],
    ['', 'per call', usd(r.perCall), `${num(r.params.minutes)}-minute call`],
    ['', 'per month', usd(r.monthly, 0), `${int(r.params.monthlyCalls)} calls${local ? ` · ${r.local.currency} ${int(r.local.monthly)} net` : ''}`],
    r.modelOnDeployment ? ['', 'plus', 'Model', 'billed on your own deployment (pay-as-you-go or PTU), not priced here']
      : ['', 'audio share', pct(r.audioShare), 'STT, TTS and the audio the model hears'],
  ];
  container.replaceChildren(...tiles.map(([kind, name, value, note]) => {
    const tile = node('div', `tile ${kind}`);
    tile.append(node('span', 'eyebrow', name.toUpperCase()), node('strong', 'tile-value', value), node('small', '', note));
    return tile;
  }));
}

// The tokens behind one cost line, for its tooltip.
function lineDetail(line, r) {
  const b = r.breakdown;
  if (line.key === 'stt') return `${int(b.speechIn.tokens)} caller audio tokens × ${rate(b.speechIn.rate)}/1M`;
  if (line.key === 'tts') return `${int(b.speechOut.tokens)} voice tokens × ${rate(b.speechOut.rate)}/1M`;
  if (line.key === 'model_input') return `${int(tokensOf(b.firstTime) + tokensOf(b.miss))} uncached + ${int(tokensOf(b.cached))} cached input tokens`;
  const summaries = b.summaries.count ? `${int(b.summaries.count)} compaction summaries` : '';
  return [`${int(tokensOf(b.output))} output tokens`, summaries].filter(Boolean).join(' + ');
}

// One row per cost line in ¢/min, the unit of the tree; the tooltip gives the tokens and the amount per call.
export function renderBill(container, r) {
  const T = r.params.minutes;
  const lines = r.lines.filter(line => line.value > 0).sort((a, b) => b.value - a.value);
  const max = lines[0].value;
  container.replaceChildren(...lines.map(line => {
    const row = node('div', 'bill-row');
    row.tabIndex = 0;
    const bar = node('span', `bill-bar ${line.series}`);
    bar.style.width = `${Math.max(1.5, 100 * line.value / max)}%`;
    const track = node('span', 'bill-track');
    track.append(bar);
    row.append(node('span', 'bill-label', line.label), track, node('span', 'bill-value', cpm(line.value / T * 100)));
    attachTooltip(row, () => `${lineDetail(line, r)} = ${usd(line.value)} a call (${pct(line.value / r.perCall)} of the price)`);
    return row;
  }));
}

// What to compare by default: the three standard options, the current one and the three cheapest managed options.
// BYOM is left out of "cheapest": its price leaves the model out, so it is not like for like.
export function comparisonIds(params, currentId) {
  const cheapest = SCHEMES.filter(scheme => scheme.hosting === 'managed').map(scheme => ({id: scheme.id, value: priceCall(params, scheme).perMinute}))
    .sort((a, b) => a.value - b.value).slice(0, 3).map(item => item.id);
  return [...new Set([...PRESETS, currentId, ...cheapest])];
}

export function rankOptions(params, ids = SCHEMES.map(scheme => scheme.id)) {
  ids = ids.map(id => schemeById(id).id);
  return SCHEMES.filter(scheme => ids.includes(scheme.id))
    .map(scheme => ({scheme, r: priceCall(params, scheme)}))
    // Managed first by price, then BYOM: a BYOM price leaves the model out, so it does not rank against managed.
    .sort((a, b) => Number(a.r.modelOnDeployment) - Number(b.r.modelOnDeployment) || a.r.perMinute - b.r.perMinute);
}

export function rankingSummary(rows) {
  return rows.map(({scheme, r}) => ({option: scheme.id, name: `${scheme.name} (${scheme.tier})`, per_minute: `${(r.perMinute * 100).toFixed(2)} cents${r.extra ? ` + ${r.extra}` : ''}`,
    per_call: `${usd(r.perCall)}${r.extra ? ` + ${r.extra}` : ''}`}));
}

export function renderCompare(container, params, currentId, ids) {
  const rows = rankOptions(params, ids);
  const max = Math.max(...rows.map(row => row.r.perMinute));
  container.replaceChildren(...rows.map(({scheme, r}) => {
    const row = node('div', `compare-row${scheme.id === currentId ? ' current' : ''}`);
    row.tabIndex = 0;
    row.dataset.scheme = scheme.id;
    const bar = node('span', 'compare-bar');
    bar.style.width = `${Math.max(1.5, 100 * r.perMinute / max)}%`;
    const name = node('span', 'compare-label', scheme.name);
    if (scheme.id === currentId) name.append(node('b', 'current-tag', ' current'));
    const track = node('span', 'bill-track');
    track.append(bar);
    row.append(name, track, node('span', 'bill-value', r.extra ? `${cents(r.perMinute)} + model` : cents(r.perMinute)));
    attachTooltip(row, `${scheme.name} (${scheme.pipeline}, ${scheme.tier}): ${usd(r.perCall)} a call, ${usd(r.monthly, 0)} a month`
      + (r.extra ? `, plus the ${r.extra}` : ''));
    return row;
  }));
}

// Per-minute price for call lengths 1-60 min, with markers at 10, 15 and 30 and a crosshair tooltip.
export function renderCurve(container, params, scheme) {
  const points = Array.from({length: 60}, (_, i) => {
    const minutes = i + 1;
    return {minutes, value: priceCall({...params, minutes}, scheme).perMinute};
  });
  const W = 760, H = 240, left = 56, right = 20, top = 16, bottom = 34;
  const maxY = Math.max(...points.map(point => point.value)) * 1.1;
  const x = minutes => left + (minutes - 1) / 59 * (W - left - right);
  const y = value => top + (1 - value / maxY) * (H - top - bottom);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Price per minute for ${scheme.name} from 1 to 60 minutes`);
  for (let i = 0; i <= 4; i++) {
    const value = maxY * i / 4;
    svgNode(svg, 'line', {x1: left, x2: W - right, y1: y(value), y2: y(value), class: 'grid'});
    svgNode(svg, 'text', {x: left - 8, y: y(value) + 4, class: 'axis', 'text-anchor': 'end'}).textContent = `${(value * 100).toFixed(1)}¢`;
  }
  for (const minutes of [1, 10, 15, 20, 30, 40, 50, 60])
    svgNode(svg, 'text', {x: x(minutes), y: H - 12, class: 'axis', 'text-anchor': 'middle'}).textContent = `${minutes}m`;
  svgNode(svg, 'path', {d: points.map((point, i) => `${i ? 'L' : 'M'} ${x(point.minutes)} ${y(point.value)}`).join(' '), class: 'curve-line'});
  for (const minutes of [10, 15, 30]) {
    const point = points[minutes - 1];
    svgNode(svg, 'circle', {cx: x(minutes), cy: y(point.value), r: 5, class: `curve-dot${minutes === params.minutes ? ' current' : ''}`});
    svgNode(svg, 'text', {x: x(minutes), y: y(point.value) - 12, class: 'curve-label', 'text-anchor': 'middle'}).textContent = cents(point.value);
  }
  const cross = svgNode(svg, 'line', {y1: top, y2: H - bottom, class: 'crosshair', visibility: 'hidden'});
  const dot = svgNode(svg, 'circle', {r: 5, class: 'curve-dot hover', visibility: 'hidden'});
  const hit = svgNode(svg, 'rect', {x: left, y: top, width: W - left - right, height: H - top - bottom, class: 'hit'});
  const pick = event => {
    const box = svg.getBoundingClientRect();
    const px = (event.clientX - box.left) / box.width * W;
    return points[Math.min(59, Math.max(0, Math.round((px - left) / (W - left - right) * 59)))];
  };
  attachTooltip(hit, event => {
    const point = pick(event);
    for (const [element, attrs] of [[cross, {x1: x(point.minutes), x2: x(point.minutes)}], [dot, {cx: x(point.minutes), cy: y(point.value)}]]) {
      for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
      element.setAttribute('visibility', 'visible');
    }
    return `${point.minutes}-minute call: ${cents(point.value)} per minute`;
  });
  hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); });
  container.replaceChildren(svg);
}

export function assumptions(r) {
  const usage = `Usage scales with call length: ${num(r.responsesPerMinute)} model responses a minute (replies and tool calls), caller ${num(r.params.callerTalkPercent)}% and agent ${num(r.params.agentTalkPercent)}% of the call.`;
  return [
    usage,
    'Priced response by response: every response sends the instructions, the history and the new audio, and the part the previous response already sent is read from the cache in whole blocks once it reaches 1,024 tokens.',
    'Cache: no hit rate goes in. What a request sends for the first time (the first instructions, each node logic when it takes over, each new audio, each agent reply) pays the full rate once and is cached after that, in whole 128-token blocks: the tail that does not fill a block is sent again at the full rate. Handoffs fall where a real graph routes: short routing nodes first, the main node in the middle and one end node for the last turns, so the long history is handed off once, at the end; an if-else branch the call does not take still holds its share of the logic. After each handoff only the shared system prompt stays cached. With one prompt, compaction runs every 10 caller turns by default.',
    'A handoff costs one extra response (the handoff call) and keeps only the shared system prompt warm; a compaction rewrites the history, so the next response pays it at the full price. A small text model writes each summary.',
    'Realtime: inside each turn the caller audio is cached before the reply text, as in a live session. Against 14 measured realtime arms this puts the input cost within 4.4% on average (11.1% with text first).',
    r.params.cascadeCacheFallback
      ? 'Cascade: as measured, 20% of requests with one prompt (40% with handoffs) fall back to the cached system prompt and 2.3% (4.5%) miss the cache.'
      : 'Cascade: every request is priced as a full cache hit; measured calls fell back or missed on 22% to 45% of requests.',
    'On Cascade the model is 4.3–8.4 points more optimistic than measured about compaction savings, and prices a split without compaction above the measured cost.',
    ...(r.modelOnDeployment ? [`BYOM: the voice agent bills only speech, at the BYO rate (STT ${rate(BYO_SPEECH.audioInput)}, TTS ${rate(BYO_SPEECH.audioOutput)} per 1M audio tokens, whatever the model); a BYOM session always transcribes the caller. The model is billed on your own deployment, pay-as-you-go or PTU, and is not priced here.`] : []),
  ];
}

// Status labels carry an icon and words, never colour alone.
const VERDICT = {saves: ['✓', 'Measured: saves here', 'ok'], depends: ['◐', 'Measured: only in some cases', 'warn'],
  'costs-more': ['✕', 'Measured: costs more here', 'bad'], model: ['○', 'Not measured', 'neutral']};

export function renderSavings(container, params, scheme, onApply) {
  const tips = savingsTips(params, scheme);
  if (!tips.length) {
    container.replaceChildren(node('p', 'savings-empty', 'Nothing in this list lowers the price for these inputs.'));
    return tips;
  }
  container.replaceChildren(...tips.map(tip => {
    const [icon, label, tone] = VERDICT[tip.verdict];
    const card = node('article', `saving-card ${tone}`);
    card.dataset.tip = tip.id;
    const head = node('div', 'saving-head');
    head.append(node('strong', 'saving-title', tip.title), node('span', `verdict-chip ${tone}`, `${icon} ${label}`));
    const figure = node('p', 'saving-figure');
    figure.append(node('b', '', `−${cpm(-tip.delta)}`), document.createTextNode(` (${pct(-tip.share, 1)}) ${tip.active ? 'saved now: already on' : 'in this planning model'}`));
    card.append(head, figure, node('p', 'saving-evidence', tip.evidence), node('p', 'saving-how', tip.how));
    if (tip.note) card.append(node('p', 'saving-note', tip.note));
    const button = node('button', 'ghost-button', tip.active ? 'Turn off to compare' : 'Try it');
    button.type = 'button';
    button.onclick = () => onApply(tip);
    card.append(button);
    return card;
  }));
  return tips;
}
