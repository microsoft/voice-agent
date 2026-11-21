// Response-by-response cost model, ported from a Python reference model that was checked against measured calls.
// One call is walked response by response: request = node prompt + conversation history + new caller input.
// The prompt cache hits the previous request floored to 128-token blocks (nothing below 1,024 tokens). After a
// handoff only the shared system prompt stays cached; after a compaction in the same node, only the node prompt.
// Realtime keeps the caller's audio in the history; Cascade keeps the transcript and, as measured, often falls back
// to caching only the static prompt. There is no flat cache hit rate: hits come out of the walk.
// One difference from the Python model, on by default (audioFirst): inside a history entry the cached prefix covers
// the caller's audio before the reply text, as in a live conversation (the caller's audio item comes first). The
// Python model fills text first, which leaves caller audio ($32 per 1M on Pro) uncached where the reply text ($4)
// really is. Measured realtime calls match this order better; Cascade history holds no audio and is unchanged.
// The first request of a call is cold (warmFirst off): its instructions are sent for the first time and pay the full
// rate. The Python model assumes concurrent calls keep them warm; the golden parity tests set warmFirst for that.
// Totals are also split by where each token sits (node prompt, history, new input), so the cost tree can show
// first-time, cache-miss and cached input.

const BLOCK = 128, MIN_CACHE = 1024;
// A separate small text model writes each summary (gpt-4.1-mini: 800 tokens in, 160 out), USD per compaction.
export const SUMMARY_USD = (800 * 0.40 + 160 * 1.60) / 1e6;

// The reference profile: 3 responses a minute, caller 55% / agent 35%, 2,000 system + 5 stages x 800 = 6,000 single prompt.
export const PROFILE = Object.freeze({
  pipeline: 'realtime', minutes: 15, respPerMin: 3, userTalk: 0.55, agentTalk: 0.35, stages: 5, nodes: 1,
  sysTokens: 2000, stageTokens: 800, outTextPerResp: 130, histTextPerResp: 160, transcriptTokPerS: 3, userFraming: 8,
  summaryTokens: 180, strategy: 'none', periodicEvery: 8, periodicKeep: 2, respPerTurn: 1.2, handoffCallTokens: 30,
  warmStatic: 'sys', cascadeFallbackFlat: 0.20, cascadeZeroFlat: 0.023, cascadeFallbackHandoff: 0.40, cascadeZeroHandoff: 0.045,
  inAudioRate: 10, outAudioRate: 20, audioFirst: true, warmFirst: false, schedule: 'routing', branchNodes: 0,
});
export const STRATEGIES = Object.freeze(['none', 's1', 's2', 'periodic']);

// Python's round(): halves go to the even neighbour.
export function pyRound(x) {
  const floor = Math.floor(x), rest = x - floor;
  if (rest > 0.5) return floor + 1;
  if (rest < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

// Python's float floor division (CPython float_floor_div), so stage-to-node mapping matches exactly.
function pyFloorDiv(a, b) {
  const mod = a % b;
  let div = (a - mod) / b;
  if (mod && (b < 0) !== (mod < 0)) div -= 1;
  if (!div) return 0;
  let floor = Math.floor(div);
  if (div - floor > 0.5) floor += 1;
  return floor;
}

// Where the handoffs fall when the prompt is split into nodes, the way real graphs route: the routing nodes, about 2
// caller turns each, all at the start; the main node (two from 6 running nodes up) holds the middle; one end node
// takes the last turns, so the long history is handed off only once, at the end. An if-else branch node is part of
// the prompt but not taken in this call: it holds its share of the logic (sized like a routing node) and never runs.
// Each node's logic is in proportion to its responses. schedule 'even' keeps the Python model's equal stages for
// the golden parity tests.
export function nodePlan(kTotal, nodes, respPerTurn = 1, logicTokens = 0, branches = 0) {
  if (nodes <= 1) return [{role: 'main', start: 0, length: kTotal, logic: logicTokens}];
  const branch = Math.min(Math.max(0, branches), Math.max(0, nodes - 2)); // at least a main node and an end node run
  const running = nodes - branch, mains = running >= 6 ? 2 : 1, routing = running - mains - 1;
  let len = Math.max(1, pyRound(2 * respPerTurn));
  if ((routing + 1) * len > kTotal / 2) len = Math.max(1, Math.floor(kTotal / 2 / (routing + 1)));
  const mainTotal = Math.max(0, kTotal - (routing + 1) * len);
  const run = [...Array(routing).fill(['routing', len]),
    ...Array.from({length: mains}, (_, i) => ['main', Math.floor(mainTotal / mains) + (i < mainTotal % mains ? 1 : 0)]), ['end', len]];
  // A call too short for every node gives up routing turns first, nearest the main node first.
  let over = run.reduce((total, [, n]) => total + n, 0) - kTotal;
  for (let i = routing - 1; i >= 0 && over > 0; i--) {
    const cut = Math.min(over, run[i][1]);
    run[i] = ['routing', run[i][1] - cut];
    over -= cut;
  }
  const weight = run.reduce((total, [, n]) => total + n, 0) + branch * len;
  const share = n => Math.round(logicTokens * n / weight);
  const plan = [];
  let start = 0;
  run.forEach(([role, length], i) => {
    if (i === routing) for (let b = 0; b < branch; b++) plan.push({role: 'branch', start: null, length: 0, logic: share(len)});
    if (length > 0) plan.push({role, start, length, logic: share(length)});
    start += length;
  });
  return plan;
}

const floorBlock = n => {
  const whole = Math.trunc(n);
  return whole >= MIN_CACHE ? Math.floor(whole / BLOCK) * BLOCK : 0;
};

export function simulate(input = {}) {
  const p = {...PROFILE, ...input};
  if (!STRATEGIES.includes(p.strategy)) throw new Error(`strategy must be one of: ${STRATEGIES.join(', ')}.`);
  const kTotal = Math.max(1, pyRound(p.respPerMin * p.minutes));
  const userS = p.userTalk * 60 * p.minutes, agentS = p.agentTalk * 60 * p.minutes;
  const realtime = p.pipeline === 'realtime';
  const newAud = realtime ? userS * p.inAudioRate / kTotal : 0;
  const newTxt = p.userFraming + (realtime ? 0 : userS * p.transcriptTokPerS / kTotal);
  const perNode = p.stages / p.nodes;
  const evenNodeOf = k => Math.trunc(pyFloorDiv(Math.min(p.stages - 1, Math.floor(k * p.stages / kTotal)), perNode));
  const evenStatic = p.sysTokens + p.stageTokens * (p.nodes === 1 ? p.stages : perNode);
  const plan = p.nodes > 1 && p.schedule !== 'even' ? nodePlan(kTotal, p.nodes, p.respPerTurn, p.logicTokens ?? p.stageTokens * p.stages, p.branchNodes) : null;
  const nodeAt = plan ? plan.flatMap((node, index) => Array(node.length).fill(index)) : null;
  const nodeOf = k => (plan ? nodeAt[k] : evenNodeOf(k));
  const staticOf = node => (plan ? p.sysTokens + plan[node].logic : evenStatic);
  const staticTokens = plan ? plan.reduce((total, node) => total + (p.sysTokens + node.logic) * node.length, 0) / kTotal : evenStatic;

  const t = {cachedStatic: 0, uncStatic: 0, cachedHistTxt: 0, uncHistTxt: 0, cachedHistAud: 0, uncHistAud: 0,
    newTxt: 0, newAud: 0, outReplies: 0, outHandoff: 0, compactions: 0, busts: 0, responses: 0, handoffs: 0,
    // Uncached tokens by why they missed (st = static prompt, txt = history text, aud = history audio).
    why: Object.fromEntries(['new', 'rounding', 'fallback', 'handoff', 'compaction'].map(reason => [reason, {st: 0, txt: 0, aud: 0}]))};
  const trace = []; // one row per response, for the page's diagrams
  let hist = []; // {txt, aud, node}; node -1 = summary
  let prev = null;

  // bust: '' = prefix intact; 'handoff' = node prompt swapped; 'compact' = same node, history rewritten.
  function respond(node, inTxt, inAud, bust, out, adds, handoffCall) {
    const st = staticOf(node);
    const histTxt = hist.reduce((total, h) => total + h.txt, 0);
    const histAud = hist.reduce((total, h) => total + h.aud, 0);
    const prompt = st + histTxt + inTxt + histAud + inAud;
    let cached;
    // First response: cold, unless warmFirst (concurrent calls keep the static prompt cached). Same-node compaction
    // leaves the static prompt intact.
    if (prev === null) cached = p.warmFirst ? Math.min(floorBlock(st), floorBlock(prompt)) : 0;
    else if (bust === 'compact') cached = Math.min(floorBlock(st), floorBlock(prompt));
    else if (bust === 'handoff') cached = Math.min(floorBlock(p.warmStatic === 'node' ? st : p.sysTokens), floorBlock(prompt));
    else cached = floorBlock(Math.min(prev, prompt));
    // Cascade is stateless: measured responses fell back to the static prompt or missed entirely.
    if (!realtime && prev !== null) {
      const flat = p.nodes === 1;
      const fallback = flat ? p.cascadeFallbackFlat : p.cascadeFallbackHandoff;
      const zero = flat ? p.cascadeZeroFlat : p.cascadeZeroHandoff;
      cached = (1 - fallback - zero) * cached + fallback * Math.min(cached, floorBlock(st));
    }
    const order = p.audioFirst ? ['aud', 'txt'] : ['txt', 'aud'];
    // Tokens of each kind in the first x tokens of the request: the static prompt, then each history entry.
    const fillAt = x => {
      let left = Math.max(0, x);
      const out = {st: Math.min(left, st), txt: 0, aud: 0};
      left -= out.st;
      for (const h of hist) {
        if (left <= 0) break;
        for (const kind of order) {
          const y = Math.min(left, h[kind]);
          out[kind] += y;
          left -= y;
        }
      }
      return out;
    };
    const atCached = fillAt(cached);
    const {st: cStatic, txt: cTxt, aud: cAud} = atCached;
    // Why the rest pays the full rate, so the cost tree lists exactly what the walk prices. matched: how far this
    // request is the same as the previous one (nothing when cold, the system prompt after a handoff, the node prompt
    // after a compaction, otherwise the whole previous request). The cache holds whole 128-token blocks of it.
    const matched = prev === null ? (p.warmFirst ? Math.min(st, prompt) : 0) : bust === 'compact' ? Math.min(st, prompt)
      : bust === 'handoff' ? Math.min(p.warmStatic === 'node' ? st : p.sysTokens, prompt) : Math.min(prev, prompt);
    const atBlocks = fillAt(floorBlock(matched)), atMatched = fillAt(matched);
    for (const kind of ['st', 'txt', 'aud']) {
      t.why.fallback[kind] += atBlocks[kind] - atCached[kind];
      t.why.rounding[kind] += atMatched[kind] - atBlocks[kind];
    }
    // Past the matched part: the static prompt is sent for the first time (cold start, or the new node's logic), the
    // agent's last reply is sent as input for the first time, and the rest sits behind a handoff or a compaction.
    const restTxt = histTxt - atMatched.txt, reply = Math.min(restTxt, hist.length ? hist[hist.length - 1].added ?? 0 : 0);
    const behind = bust === 'compact' ? 'compaction' : bust === 'handoff' ? 'handoff' : 'rounding';
    t.why.new.st += st - atMatched.st;
    t.why.new.txt += reply;
    t.why[behind].txt += restTxt - reply;
    t.why[behind].aud += histAud - atMatched.aud;
    t.cachedStatic += cStatic;
    t.uncStatic += st - cStatic;
    t.cachedHistTxt += cTxt;
    t.uncHistTxt += histTxt - cTxt;
    t.cachedHistAud += cAud;
    t.uncHistAud += histAud - cAud;
    t.newTxt += inTxt;
    t.newAud += inAud;
    if (handoffCall) { t.outHandoff += out; t.handoffs += 1; } else t.outReplies += out;
    t.busts += bust ? 1 : 0;
    t.responses += 1;
    trace.push({node, bust, handoffCall, instructions: st, cachedInstructions: cStatic, historyText: histTxt, cachedText: cTxt,
      historyAudio: histAud, cachedAudio: cAud});
    hist.push({txt: inTxt + adds, aud: inAud, node, added: adds});
    prev = prompt;
  }

  const summary = () => ({txt: p.summaryTokens, aud: 0, node: -1});
  const every = Math.max(1, pyRound(p.periodicEvery * p.respPerTurn));
  const keep = Math.max(1, pyRound(p.periodicKeep * p.respPerTurn));
  let current = nodeOf(0), s2At = null;
  for (let k = 0; k < kTotal; k++) {
    const node = nodeOf(k);
    let bust = '';
    if (node !== current) {
      // The source node first spends one extra response on the handoff function call (re-reads its prompt).
      respond(current, 0, 0, '', p.handoffCallTokens, p.handoffCallTokens + 20, true);
      bust = 'handoff';
      current = node;
      if (p.strategy === 's1') { hist = [summary()]; t.compactions += 1; }
      else if (p.strategy === 's2') s2At = k + 1;
    } else if (p.strategy === 's2' && s2At === k) {
      hist = [summary(), ...hist.filter(h => h.node === node)];
      bust = 'compact';
      s2At = null;
      t.compactions += 1;
    }
    if (p.strategy === 'periodic' && k && k % every === 0) {
      hist = [summary(), ...hist.filter(h => h.node !== -1).slice(-keep)];
      bust = bust || 'compact';
      t.compactions += 1;
    }
    respond(node, newTxt, newAud, bust, p.outTextPerResp, p.histTextPerResp, false);
  }
  return {
    ...t, trace, profile: p, kTotal, staticTokens, plan, userS, agentS,
    callerAudioTokens: userS * p.inAudioRate, agentAudioTokens: agentS * p.outAudioRate,
    // The Python model's totals.
    cachedTxt: t.cachedStatic + t.cachedHistTxt, uncTxt: t.uncStatic + t.uncHistTxt + t.newTxt,
    cachedAud: t.cachedHistAud, uncAud: t.uncHistAud + t.newAud, outTxt: t.outReplies + t.outHandoff,
  };
}

// USD per call. rates: txtIn, txtCached, audIn, audCached, txtOut (model), stt, tts (speech), per 1M tokens.
export function price(t, rates) {
  const m = 1e6;
  const input = (t.uncTxt * rates.txtIn + t.cachedTxt * rates.txtCached
    + t.uncAud * (rates.audIn ?? 0) + t.cachedAud * (rates.audCached ?? 0)) / m;
  const output = t.outTxt * rates.txtOut / m;
  const fixedSpeech = (t.callerAudioTokens * rates.stt + t.agentAudioTokens * rates.tts) / m;
  const summary = t.compactions * SUMMARY_USD;
  return {input, output, llm: input + output, fixedSpeech, summary, total: input + output + fixedSpeech + summary};
}
