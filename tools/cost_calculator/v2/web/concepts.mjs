// Concept animations for the detail area: what each response sends to the model (instructions first,
// then the conversation so far, one turn more each time), how the cache prices the repeated start, and
// what a handoff and a compaction do to it. Drawn in the stage SVG (720 × 420): solid means new and
// billed at the full rate, hatched means sent before and billed at the cached rate when it hits.
import {format} from './steps.mjs';

const NS = 'http://www.w3.org/2000/svg';
const {num, pct, rate} = format;
const PROMPT = 90, AUDIO = 26, TEXT = 14, HEIGHT = 30, GAP = 12, X0 = 120, BOTTOM = 330;

function el(parent, tag, attrs = {}, content) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (content !== undefined) node.textContent = content;
  parent.append(node);
  return node;
}
const label = (parent, x, y, content, cls = 'st-label', anchor = 'start') => el(parent, 'text', {x, y, class: cls, 'text-anchor': anchor}, content);

export const CONCEPT_TEXT = {
  request: {title: 'What each response sends', text: 'Every response sends the whole conversation again: the instructions first, then every earlier turn, then the newest one. Each request repeats the previous one and adds one turn at the end, so the requests stack up turn by turn.'},
  cache: {title: 'How the cache prices it', text: 'The start of a request that is the same as the previous request can hit the cache and is billed at the cached rate; the new end always pays the full rate. The price counts this response by response, in whole 128-token blocks.'},
  handoff: {title: 'What a handoff does', text: 'A handoff swaps the stage block behind the shared core. The core still hits the cache, but the new stage block and the whole conversation behind it are new to the cache once and pay the full rate on that request, after one extra response that writes the handoff call. The price includes both.'},
  compaction: {title: 'What a compaction does', text: 'A compaction replaces earlier turns with a short summary. Later requests are shorter, but the request right after it changes behind the instructions, so everything from the summary on pays the full rate once. The price includes that one-off cost and the summary itself.'},
};

// One earlier turn as it sits in a later request: realtime keeps the caller as audio plus the reply text,
// speech options keep text only. The newest turn is only the caller's new input.
const earlier = (realtime, cached = true) => realtime
  ? [{w: AUDIO, series: 's3', cached}, {w: TEXT, series: 's4', cached}] : [{w: TEXT + 16, series: 's4', cached}];
const newest = realtime => [{w: realtime ? AUDIO : TEXT + 6, series: realtime ? 's1' : 's4'}];

// Draws the requests bottom-up, one row at a time; returns each row's y and right edge.
function stack(stage, rows, {perRow = 420, delay = 0} = {}) {
  const svg = stage.svg;
  return rows.map((row, index) => {
    const y = BOTTOM - index * (HEIGHT + GAP);
    label(svg, X0 - 12, y + HEIGHT / 2 + 5, row.label, 'st-label', 'end');
    let x = X0;
    const parts = row.segments.map(segment => {
      const rect = el(svg, 'rect', {x, y, width: 0, height: HEIGHT, rx: 3,
        ...(segment.cached ? {fill: `url(#hatch-${segment.series})`} : {class: segment.series})});
      const part = {rect, w: segment.w, x};
      if (segment.tag) part.tag = label(svg, x + segment.w / 2, y + HEIGHT / 2 + 4, '', 'st-tag', 'middle');
      part.text = segment.tag;
      x += segment.w + 2;
      return part;
    });
    stage.tween(450, t => parts.forEach(part => {
      part.rect.setAttribute('width', Math.max(0, part.w * t));
      if (part.tag) part.tag.textContent = t > .9 ? part.text : '';
    }), delay + index * perRow);
    return {y, end: x};
  });
}

function legend(svg) {
  el(svg, 'rect', {x: X0, y: 384, width: 18, height: 12, rx: 2, class: 's4'});
  label(svg, X0 + 26, 395, 'new: full rate');
  el(svg, 'rect', {x: X0 + 150, y: 384, width: 18, height: 12, rx: 2, fill: 'url(#hatch-s4)'});
  label(svg, X0 + 176, 395, 'sent before: cached rate when it hits');
}

// Notes that appear once the row they describe has been drawn.
function note(stage, x, y, lines, delay, cls = 'st-label') {
  const texts = lines.map((line, index) => label(stage.svg, x, y + index * 17, '', cls));
  stage.tween(300, t => texts.forEach((text, index) => { text.textContent = t > .5 ? lines[index] : ''; }), delay);
}

function requests(realtime, count, {prompt = i => [{w: PROMPT, series: 's4', cached: i > 1, tag: i === 1 ? 'instructions' : ''}],
  turns = i => Array.from({length: i - 1}, () => earlier(realtime)).flat()} = {}) {
  return Array.from({length: count}, (_, index) => {
    const i = index + 1;
    return {label: `request ${i}`, segments: [...prompt(i), ...turns(i), ...newest(realtime)]};
  });
}

function request(stage, r) {
  const realtime = r.mode === 'realtime';
  label(stage.svg, 60, 40, 'WHAT EACH RESPONSE SENDS TO THE MODEL', 'st-eyebrow');
  label(stage.svg, 60, 64, `${num(r.responses / r.params.minutes)} requests a minute, ${r.responses} in this call: the first six shown`, 'st-label');
  const rows = stack(stage, requests(realtime, 6));
  note(stage, rows[0].end + 12, rows[0].y + 19, ['first request: nothing sent before'], 400);
  note(stage, rows[5].end + 12, rows[5].y + 12, ['instructions and earlier turns: sent before', 'newest turn: new, full rate'], 6 * 420);
  legend(stage.svg);
}

function cache(stage, r, scheme) {
  const realtime = r.mode === 'realtime', s = scheme.rates;
  const full = realtime ? s.audioInput : s.textInput;
  label(stage.svg, 60, 40, 'HOW THE CACHE PRICES WHAT IS SENT AGAIN', 'st-eyebrow');
  const rows = stack(stage, requests(realtime, 4), {perRow: 160});
  const top = rows[3], newStart = top.end - (realtime ? AUDIO : TEXT + 6) - 2;
  const bracket = (x1, x2, text, delay) => {
    const path = el(stage.svg, 'path', {d: `M ${x1} ${top.y - 6} V ${top.y - 14} H ${x2} V ${top.y - 6}`, class: 'st-bracket', opacity: 0});
    stage.tween(300, t => path.setAttribute('opacity', t), delay);
    note(stage, x1, top.y - 22, [text], delay);
  };
  bracket(X0, newStart - 4, 'same start as request 3: can hit the cache', 900);
  bracket(newStart, top.end - 2, '', 1200);
  note(stage, top.end + 12, top.y + 20, ['new: full rate'], 1200);
  // This call, walked response by response: the share of everything sent again that the cache covered.
  const share = r.resentHitShare;
  const width = 420, y = 92;
  label(stage.svg, 60, y - 12, r.modelOnDeployment ? 'BYOM: the model and its cache are billed on your own deployment, not here'
    : `This call: of everything sent again, ${pct(share, 1)} hits the cache`, 'st-label');
  const series = realtime ? 's3' : 's4';
  const hit = el(stage.svg, 'rect', {x: 60, y, width: 0, height: 28, rx: 3, fill: `url(#hatch-${series})`});
  const miss = el(stage.svg, 'rect', {x: 60, y, width: 0, height: 28, rx: 3, class: series});
  stage.tween(900, t => {
    hit.setAttribute('width', width * share * t);
    miss.setAttribute('x', 60 + width * share * t + 2);
    miss.setAttribute('width', Math.max(0, width * (1 - share) * t - 2));
  }, 1500);
  note(stage, 60, y + 46, [`${pct(share, 1)} at ${rate(s.textCached)} / 1M  ·  ${pct(1 - share, 1)} at ${rate(full)} / 1M`], 2400);
  if (s.textCached) {
    const big = label(stage.svg, 600, y + 24, '', 'st-big', 'middle');
    stage.tween(900, t => { big.textContent = `${Math.round(full / s.textCached * t)}×`; }, 1500);
    label(stage.svg, 600, y + 46, realtime ? 'full audio vs cached' : 'full text vs cached', 'st-label', 'middle');
  }
  legend(stage.svg);
}

function handoff(stage, r) {
  const realtime = r.mode === 'realtime', SWITCH = 4;
  label(stage.svg, 60, 40, 'WHAT A HANDOFF DOES TO THE CACHE', 'st-eyebrow');
  const handoffs = r.breakdown.handoffs;
  note(stage, 60, 64, [handoffs ? `This call has ${handoffs} handoffs; each pays the one-off cost at request 4.`
    : 'One prompt in these inputs, so no handoff; this shows what one would do.'], 0, 'st-note');
  const rows = stack(stage, requests(realtime, 6, {
    prompt: i => [{w: 52, series: 's4', cached: i > 1, tag: i === 1 ? 'core' : ''},
      {w: 40, series: i < SWITCH ? 's2' : 's5', cached: i > 1 && i !== SWITCH, tag: i === 1 ? 'stage A' : i === SWITCH ? 'stage B' : ''}],
    turns: i => Array.from({length: i - 1}, () => earlier(realtime, i !== SWITCH)).flat()}));
  const row = rows[SWITCH - 1];
  note(stage, row.end + 12, row.y + 12, ['handoff: stage block swapped,', 'everything behind the core pays full rate once'], SWITCH * 420, 'st-note');
  legend(stage.svg);
}

function compaction(stage, r) {
  const realtime = r.mode === 'realtime', AT = 4;
  label(stage.svg, 60, 40, 'WHAT A COMPACTION DOES TO THE CACHE', 'st-eyebrow');
  const compactions = r.breakdown.summaries.count;
  note(stage, 60, 64, [compactions
    ? `This call has ${compactions} compactions; each pays the one-off cost at request 4, and a small model writes the summary.`
    : 'Compaction is off in these inputs; this shows what one would do.'], 0, 'st-note');
  const rows = stack(stage, requests(realtime, 6, {
    turns: i => i < AT ? Array.from({length: i - 1}, () => earlier(realtime)).flat()
      : [{w: 24, series: 's5', cached: i > AT, tag: i === AT ? 'sum' : ''},
        ...Array.from({length: i - 3}, () => earlier(realtime, i > AT)).flat()]}));
  const row = rows[AT - 1];
  note(stage, row.end + 12, row.y + 12, ['compaction: turns 1–2 become a summary,', 'everything behind the instructions pays full rate once'], AT * 420, 'st-note');
  legend(stage.svg);
}

export const DRAW = {request, cache, handoff, compaction};
