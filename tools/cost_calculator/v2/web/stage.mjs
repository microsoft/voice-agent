// The animated diagram for each tree node, drawn in one SVG (720 × 420). Colours come from CSS classes;
// the cost lines carry their own (s1 STT, s2 TTS, s3 model input, s4 model output).
// The cached share of anything is drawn hatched, never by colour alone. The re-sent diagrams draw the walk's
// own rows (response-model.mjs), so they add up to the price shown.
import {format} from './steps.mjs';
import {DRAW} from './concepts.mjs';
import {cpm} from './cost-tree.mjs';

const NS = 'http://www.w3.org/2000/svg';
const W = 720, H = 420;
const {int, num, usd, rate, cents, pct} = format;
export const motionAllowed = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;
const STEP_VISUALS = new Set(['call_shape', 'responses', 'new_audio', 'instructions', 'text_history', 'audio_reread',
  'cache_split', 'line_costs', 'totals']);

function el(parent, tag, attrs = {}, content) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (content !== undefined) node.textContent = content;
  parent.append(node);
  return node;
}
const label = (parent, x, y, content, cls = 'st-label', anchor = 'start') =>
  el(parent, 'text', {x, y, class: cls, 'text-anchor': anchor}, content);

export class Stage {
  constructor(svg) {
    this.svg = svg;
    this.generation = 0;
  }

  clear() {
    this.generation++;
    this.svg.replaceChildren();
    const defs = el(this.svg, 'defs');
    for (const series of ['s1', 's2', 's3', 's4', 's5']) {
      const pattern = el(defs, 'pattern', {id: `hatch-${series}`, patternUnits: 'userSpaceOnUse', width: 6, height: 6,
        patternTransform: 'rotate(45)'});
      el(pattern, 'rect', {width: 6, height: 6, class: `${series} cached-bg`});
      el(pattern, 'rect', {width: 2, height: 6, class: series});
    }
    return this.generation;
  }

  // Runs draw(t) every frame for ms milliseconds (t from 0 to 1), or once at t = 1 without motion.
  tween(ms, draw, delay = 0) {
    const generation = this.generation;
    if (!motionAllowed()) { draw(1); return Promise.resolve(); }
    return new Promise(resolve => {
      const start = performance.now() + delay;
      const frame = now => {
        if (generation !== this.generation) return resolve();
        const t = Math.min(1, Math.max(0, (now - start) / ms));
        draw(1 - (1 - t) ** 3);
        if (t < 1) requestAnimationFrame(frame); else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  count(node, to, fmt, ms = 900, delay = 0, prefix = '') {
    return this.tween(ms, t => { node.textContent = prefix + fmt(to * t); }, delay);
  }

  // visual is a step diagram below or a concept from concepts.mjs.
  show(visual, r, scheme) {
    this.clear();
    if (DRAW[visual]) DRAW[visual](this, r, scheme);
    else if (typeof this[visual] === 'function' && STEP_VISUALS.has(visual)) this[visual](r, scheme);
  }

  // A call as a bar: caller, agent and silence in proportion.
  timeline(r, y = 250, dim = false) {
    const g = el(this.svg, 'g', {class: dim ? 'dimmed' : ''});
    const x0 = 60, width = 600;
    const parts = [['s1', r.callerSeconds, 'caller talks'], ['s2', r.agentSeconds, 'agent talks'], ['silence', r.silentSeconds, 'silence, not billed']];
    let x = x0;
    const bars = [];
    for (const [cls, seconds, text] of parts) {
      const w = width * seconds / r.seconds;
      const bar = el(g, 'rect', {x, y, width: 0, height: 34, rx: 4, class: cls});
      bars.push([bar, w]);
      if (!dim && w > 40) {
        label(g, x + w / 2, y + 58, `${int(seconds)} s`, 'st-value', 'middle');
        label(g, x + w / 2, y + 76, text, 'st-label', 'middle');
      }
      x += w;
    }
    this.tween(dim ? 1 : 1100, t => bars.forEach(([bar, w]) => bar.setAttribute('width', Math.max(0, w * t - 2))));
    return {g, x0, width, y};
  }

  call_shape(r) {
    label(this.svg, 60, 70, 'ONE CALL', 'st-eyebrow');
    const big = label(this.svg, 60, 130, '0 s', 'st-big');
    label(this.svg, 60, 160, `${num(r.params.minutes)} minutes × 60 seconds`, 'st-label');
    this.count(big, r.seconds, v => `${int(v)} s`, 1100);
    this.timeline(r);
    const p = r.params;
    label(this.svg, 60, 380, `In every minute: caller ${num(.6 * p.callerTalkPercent, 1)} s, agent ${num(.6 * p.agentTalkPercent, 1)} s, silence ${num(60 - .6 * (p.callerTalkPercent + p.agentTalkPercent), 1)} s`, 'st-value');
  }

  responses(r) {
    const {x0, width, y} = this.timeline(r, 280, true);
    label(this.svg, 60, 70, 'MODEL RESPONSES', 'st-eyebrow');
    const big = label(this.svg, 60, 130, 'K = 0', 'st-big');
    label(this.svg, 60, 160, `${num(r.responsesPerMinute)} per minute (${num(r.params.repliesPerMinute)} replies + ${num(r.params.toolCallsPerMinute)} tool calls) × ${num(r.params.minutes)} minutes`, 'st-label');
    const K = r.responses;
    const ticks = Array.from({length: K}, (_, i) => el(this.svg, 'rect', {x: x0 + (i + .5) * width / K - 1.5, y: 190, width: 3, height: 0, rx: 1.5, class: 's4'}));
    this.count(big, K, v => `K = ${int(v)}`, 1400, 0);
    label(this.svg, 300, 130, `= ${num(K / r.params.minutes)} per minute`, 'st-value');
    this.tween(1400, t => ticks.forEach((tick, i) => {
      const local = Math.min(1, Math.max(0, t * K - i * .6) / 4);
      tick.setAttribute('y', 190 + 60 * local);
      tick.setAttribute('height', 26 * local);
    }));
    label(this.svg, x0, y + 60, 'each tick re-sends the instructions and the conversation so far', 'st-label');
  }

  new_audio(r) {
    label(this.svg, 60, 60, 'NEW AUDIO PER MINUTE', 'st-eyebrow');
    const walk = r.breakdown.walk;
    const rows = [['s1', r.callerSeconds, walk.callerAudioTokens, r.params.inputAudioRate, 'caller', 'L'],
      ['s2', r.agentSeconds, walk.agentAudioTokens, r.params.outputAudioRate, 'agent voice', 'M']];
    rows.forEach(([cls, seconds, tokens, perSecond, who, symbol], row) => {
      const y = 130 + row * 150;
      const bars = [];
      for (let i = 0; i < 40; i++) {
        const h = 10 + 40 * Math.abs(Math.sin(i * 1.7 + row) * Math.cos(i * .37));
        bars.push(el(this.svg, 'rect', {x: 60 + i * 6, y: y - h / 2, width: 3, height: h, rx: 1.5, class: cls}));
      }
      label(this.svg, 60, y + 52, `${who} · ${num(seconds / r.params.minutes, 1)} s a minute × ${num(perSecond)} tokens/s`, 'st-label');
      el(this.svg, 'path', {d: `M 320 ${y} L 440 ${y}`, class: 'st-arrow'});
      const dots = Array.from({length: 7}, () => el(this.svg, 'circle', {cx: 320, cy: y, r: 3.5, class: cls}));
      this.tween(1500, t => dots.forEach((dot, i) => dot.setAttribute('cx', 320 + ((t * 3 + i / 7) % 1) * 120)), row * 200);
      const big = label(this.svg, 470, y + 14, '0', 'st-big');
      this.count(big, tokens / r.params.minutes, v => int(v), 1500, row * 200);
      label(this.svg, 472, y + 40, `${who} audio tokens/min`, 'st-label');
    });
  }

  // One block per response. The hatched part of a block is the cached prefix and the solid part is billed at full
  // price, so the response after a handoff shows as a solid block.
  instructions(r) {
    label(this.svg, 60, 60, 'INSTRUCTIONS ON EVERY RESPONSE', 'st-eyebrow');
    const walk = r.breakdown.walk, T = r.params.minutes;
    const rows = walk.trace.map(x => (x.instructions ? 1 - x.cachedInstructions / x.instructions : 0));
    // The blocks fill at most 440 × 290 on the left, so any call length fits beside the numbers on the right.
    const K = rows.length, gap = 4;
    const size = Math.max(3, Math.min(26, Math.floor(Math.sqrt(440 * 290 / K)) - gap));
    const perRow = Math.max(1, Math.floor(440 / (size + gap)));
    const blocks = rows.map((miss, i) => {
      const x = 60 + (i % perRow) * (size + gap), y = 100 + Math.floor(i / perRow) * (size + gap);
      const g = el(this.svg, 'g', {opacity: 0});
      if (miss < 1) el(g, 'rect', {x, y, width: size, height: size, rx: 3, fill: 'url(#hatch-s4)'});
      if (miss > 0) el(g, 'rect', {x: x + size * (1 - miss), y, width: size * miss, height: size, rx: 3, class: 's4'});
      return g;
    });
    this.tween(1400, t => blocks.forEach((block, i) => block.setAttribute('opacity', t * K > i ? 1 : 0)));
    label(this.svg, 60, 84, `one block per response, ${int(K)} in the call · hatched = cached, solid = full price`, 'st-label');
    const cx = 615;
    label(this.svg, cx, 140, 'per response', 'st-label', 'middle');
    label(this.svg, cx, 180, int(r.instructions), 'st-value', 'middle');
    label(this.svg, cx, 250, `× ${num(K / T)} a minute`, 'st-label', 'middle');
    const sent = walk.cachedStatic + walk.uncStatic;
    const big = label(this.svg, cx, 300, '0', 'st-big', 'middle');
    this.count(big, sent / T, int, 1400);
    label(this.svg, cx, 326, 'tokens/min', 'st-label', 'middle');
    label(this.svg, cx, 350, `${pct(sent ? walk.cachedStatic / sent : 0)} of it cached`, 'st-label', 'middle');
  }

  // Row k is response k and its bar is what it sends again, the cached prefix hatched and the rest solid at full
  // price. A handoff or a compaction shortens the bar or turns it solid.
  walkStair(r, {cls, total, cached, rowsLabel}) {
    const walk = r.breakdown.walk, T = r.params.minutes;
    const rows = walk.trace.map(x => ({all: x[total], hit: x[cached]}));
    const K = rows.length, x0 = 60, y0 = 80, w = 380, h = 300;
    const most = Math.max(1, ...rows.map(row => row.all)), cell = h / Math.max(1, K);
    const bars = rows.map((row, k) => {
      const y = y0 + k * cell, height = Math.max(.6, cell - .6);
      return {row, hitBar: el(this.svg, 'rect', {x: x0, y, width: 0, height, fill: `url(#hatch-${cls})`}),
        missBar: el(this.svg, 'rect', {x: x0, y, width: 0, height, class: cls})};
    });
    label(this.svg, x0, y0 - 14, rowsLabel, 'st-label');
    label(this.svg, x0 - 8, y0 + 8, '1', 'st-label', 'end');
    label(this.svg, x0 - 8, y0 + K * cell, int(K), 'st-label', 'end');
    const sent = rows.reduce((sum, row) => sum + row.all, 0), hit = rows.reduce((sum, row) => sum + row.hit, 0);
    const big = label(this.svg, 570, 200, '0', 'st-big', 'middle');
    label(this.svg, 570, 226, 'tokens/min sent again', 'st-label', 'middle');
    label(this.svg, 570, 254, `${int((sent - hit) / T)} full price + ${int(hit / T)} cached`, 'st-label', 'middle');
    label(this.svg, 570, 276, 'hatched = cached, solid = full price', 'st-label', 'middle');
    const resets = [walk.handoffs ? `${int(walk.handoffs)} handoffs` : '', walk.compactions ? `${int(walk.compactions)} compactions` : ''].filter(Boolean);
    if (resets.length) label(this.svg, 570, 304, `${resets.join(' · ')} restart the cache`, 'st-label', 'middle');
    this.tween(2200, t => {
      const shown = t * K;
      bars.forEach(({row, hitBar, missBar}, k) => {
        const grow = Math.min(1, Math.max(0, shown - k));
        const all = w * row.all / most * grow, part = w * row.hit / most * grow;
        hitBar.setAttribute('width', part);
        missBar.setAttribute('x', x0 + part);
        missBar.setAttribute('width', Math.max(0, all - part));
      });
      big.textContent = int(sent / T * t);
    });
  }

  text_history(r) {
    label(this.svg, 60, 50, 'TEXT HISTORY RE-READ', 'st-eyebrow');
    this.walkStair(r, {cls: 's4', total: 'historyText', cached: 'cachedText',
      rowsLabel: `response 1 … ${int(r.breakdown.walk.trace.length)}: each bar is the history it sends again`});
  }

  audio_reread(r) {
    label(this.svg, 60, 50, 'EARLIER CALLER AUDIO HEARD AGAIN', 'st-eyebrow');
    if (r.mode !== 'realtime') {
      label(this.svg, 360, 200, 'none', 'st-big', 'middle');
      label(this.svg, 360, 240, 'STT hears each second of the caller once;', 'st-label', 'middle');
      label(this.svg, 360, 262, 'later responses read the transcript instead', 'st-label', 'middle');
      return;
    }
    this.walkStair(r, {cls: 's3', total: 'historyAudio', cached: 'cachedAudio',
      rowsLabel: `response 1 … ${int(r.breakdown.walk.trace.length)}: each bar is the earlier caller audio it sends again`});
  }

  // A bar of re-sent tokens splits into the full-price share (solid) and the cached share (hatched).
  splitBar({y, cls, tokens, scale, name, fullRate, cachedRate, hit}) {
    const width = Math.max(6, 420 * tokens / scale);
    label(this.svg, 60, y - 12, `${name} · ${int(tokens)} tokens/min`, 'st-label');
    const full = el(this.svg, 'rect', {x: 60, y, width, height: 40, rx: 4, class: cls});
    const cached = el(this.svg, 'rect', {x: 60 + width, y, width: 0, height: 40, rx: 4, fill: `url(#hatch-${cls})`});
    const fullText = label(this.svg, 60, y + 60, '', 'st-label');
    const cachedText = label(this.svg, 60, y + 80, '', 'st-label');
    this.tween(1300, t => {
      const split = width * (1 - hit * t);
      full.setAttribute('width', split);
      cached.setAttribute('x', 60 + split);
      cached.setAttribute('width', width - split);
    }, 300).then(() => {
      fullText.textContent = `${pct(1 - hit)} at ${rate(fullRate)}/1M`;
      cachedText.textContent = `${pct(hit)} cached at ${rate(cachedRate)}/1M`;
    });
  }

  cache_split(r, scheme) {
    label(this.svg, 60, 50, 'CACHE HITS ON EVERYTHING RE-SENT', 'st-eyebrow');
    const s = scheme.rates;
    if (r.modelOnDeployment) {
      label(this.svg, 360, 200, 'not priced here', 'st-big', 'middle');
      label(this.svg, 360, 240, 'On BYOM the model and its cache are billed on your own deployment;', 'st-label', 'middle');
      label(this.svg, 360, 262, 'the voice agent bills only STT and TTS', 'st-label', 'middle');
      return;
    }
    // Tokens sent again, their cached share and average rate, from the walk.
    const audio = r.mode === 'realtime', T = r.params.minutes, b = r.breakdown;
    const group = keys => {
      const miss = keys.reduce((sum, key) => sum + b.miss[key].tokens, 0), hit = keys.reduce((sum, key) => sum + b.cached[key].tokens, 0);
      const usdTotal = keys.reduce((sum, key) => sum + b.miss[key].usd + b.cached[key].usd, 0), all = miss + hit;
      return {tokens: all / T, hit: all ? hit / all : 0, average: all ? usdTotal / all * 1e6 : 0};
    };
    const text = group(['instructions', 'history']), heard = group(['audio']);
    const audioCached = s.audioCached ?? s.textCached;
    const scale = Math.max(1, text.tokens, heard.tokens);
    this.splitBar({y: 120, cls: 's4', tokens: text.tokens, scale, name: 'Instructions + text history sent again',
      fullRate: s.textInput, cachedRate: s.textCached, hit: text.hit});
    if (audio) this.splitBar({y: 260, cls: 's3', tokens: heard.tokens, scale, name: 'Earlier audio sent again',
      fullRate: s.audioInput, cachedRate: audioCached, hit: heard.hit});
    const ratio = audio ? s.audioInput / audioCached : s.textInput / s.textCached;
    const big = label(this.svg, 600, 200, '1×', 'st-big', 'middle');
    this.count(big, ratio, v => `${int(v)}×`, 1300, 300);
    label(this.svg, 600, 230, audio ? 'full-price audio vs cached' : 'full-price text vs cached', 'st-label', 'middle');
    label(this.svg, 600, 270, `average ${rate((audio ? heard : text).average)}/1M`, 'st-value', 'middle');
    label(this.svg, 60, 392, 'Cached shares from the response-by-response walk: a handoff or a compaction restarts the cache.', 'st-label');
  }

  line_costs(r) {
    label(this.svg, 60, 50, 'COST PER MINUTE OF EACH LINE', 'st-eyebrow');
    const lines = r.lines.filter(line => line.value > 0).sort((a, b) => b.value - a.value);
    const max = lines[0].value;
    lines.forEach((line, i) => {
      const y = 90 + i * 70;
      label(this.svg, 60, y, line.label, 'st-label');
      const bar = el(this.svg, 'rect', {x: 60, y: y + 8, width: 0, height: 26, rx: 4, class: line.series});
      const value = label(this.svg, 70, y + 27, '', 'st-value');
      this.tween(900, t => {
        const width = 440 * line.value / max * t;
        bar.setAttribute('width', width);
        value.setAttribute('x', 70 + width);
        value.textContent = cpm(line.value / r.params.minutes * 100 * t);
      }, i * 250);
    });
  }

  // One stacked bar (colour follows the cost line) with a legend below it: swatch, line, ¢/min.
  stack(r, y, lines) {
    let x = 60;
    const T = r.params.minutes;
    const parts = lines.map(line => {
      const width = 600 * line.value / r.perCall;
      const part = el(this.svg, 'rect', {x, y, width: 0, height: 44, class: line.series});
      const start = x;
      x += width;
      return {part, start, width};
    });
    this.tween(1200, t => parts.forEach(({part, start, width}) => {
      part.setAttribute('x', 60 + (start - 60) * t);
      part.setAttribute('width', Math.max(0, width * t - 2));
    }));
    lines.forEach((line, i) => {
      const row = y + 70 + i * 24;
      el(this.svg, 'rect', {x: 60, y: row - 11, width: 12, height: 12, rx: 2, class: line.series});
      label(this.svg, 80, row, `${line.label} · ${cpm(line.value / T * 100)}`, 'st-label');
    });
    return y + 70 + lines.length * 24;
  }

  totals(r) {
    label(this.svg, 60, 50, r.modelOnDeployment ? 'VOICE-AGENT COST PER MINUTE = STT + TTS' : 'PRICE PER MINUTE = SUM OF THE COST LINES', 'st-eyebrow');
    const lines = r.lines.filter(line => line.value > 0).sort((a, b) => b.value - a.value);
    const bottom = this.stack(r, 80, lines);
    const y = Math.max(330, bottom + 50);
    const minute = label(this.svg, 360, y, '0.00 ¢/min', 'st-hero', 'middle');
    this.count(minute, r.perMinute * 100, v => cpm(v), 1600, 400);
    if (r.modelOnDeployment) label(this.svg, 360, y + 30, `+ ${r.extra}, billed there`, 'st-label', 'middle');
  }
}
