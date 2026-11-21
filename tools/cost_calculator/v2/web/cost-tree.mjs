// The voice-agent cost per minute as a clickable tree, grouped by what is billed:
//   STT            caller audio to text (on realtime models it runs beside the model so barge-in works)
//   TTS            the HD voice that reads every reply
//   Model input    uncached input by why it pays the full rate (sent for the first time, cache rounding, handoff,
//                  compaction, Cascade fallback) + cached input; each split into audio and text
//   Model output   replies, MCP / tool calls, reasoning, summaries
// BYOM has only STT and TTS: the model is billed on the customer's own deployment and is not priced here.
// Every cost node is in US cents per minute of call, and every quantity is per minute too: whole-call figures are
// worked out for the whole call, then divided by its length. A node is the sum of its cost children (op 'sum'),
// its factors multiplied by a constant (op 'product'), or a stated formula (op 'formula'). The page draws this
// tree and the Agent's functions read it, so both use the same numbers.
import {RATES_AS_OF} from './rate-card.mjs';
import {PROFILE, SUMMARY_USD} from './response-model.mjs';
import {format} from './steps.mjs';

const {int, num, rate, pct, usd} = format;
export const CENTS = 100 / 1e6; // tokens × USD per 1M tokens → US cents
const SERIES = {stt: 's1', tts: 's2', model_input: 's3', model_output: 's4'};

export function cpm(value) {
  const size = Math.abs(value);
  return `${value.toFixed(size === 0 || size >= 1 ? 2 : size >= .01 ? 3 : 4)} ¢/min`;
}
export const spokenCpm = value => cpm(value).replace(' ¢/min', ' cents a minute');
// Lower-case a label inside a formula, but keep acronyms: 'Model input' -> 'model input', 'STT' stays.
const lower = label => /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
const tpm = value => `${num(value, value < 10 ? 2 : 0)} tokens/min`;

const leaf = (key, kind, label, value, display, fields = {}) => ({key, kind, label, value, display, children: [], ...fields});
const share = (key, label, value, fields) => leaf(key, 'share', label, value, pct(value, 1), fields);
const perMillion = (key, label, value, fields = {}) => leaf(key, 'rate', label, value, `${rate(value)} / 1M tokens`,
  {visual: 'cache', explain: `List price per million tokens, as of ${RATES_AS_OF}.`, ...fields});

// The columns a cost row shows when it is tokens × rate: tokens per minute and USD per 1M tokens.
function columns(kind, factors) {
  const rateFactor = kind === 'cost' && factors.length === 2 ? factors.find(factor => factor.kind === 'rate') : null;
  return rateFactor ? {tokensPerMinute: factors.find(factor => factor !== rateFactor).value, usdPerM: rateFactor.value} : {};
}

function product(key, kind, label, scale, factors, fields = {}) {
  const value = factors.reduce((total, factor) => total * factor.value, scale);
  return {key, kind, label, value, display: kind === 'cost' ? cpm(value) : tpm(value), op: 'product', scale,
    numbers: (scale === 60 ? '60 s × ' : '') + factors.map(factor => factor.display).join(' × '), children: factors, ...columns(kind, factors), ...fields};
}

function sum(key, label, parts, fields = {}) {
  const value = parts.reduce((total, part) => total + part.value, 0);
  return {key, kind: 'cost', label, value, display: cpm(value), op: 'sum',
    numbers: parts.map(part => part.display).join(' + ') || '0', children: parts,
    ...(parts.length && parts.every(part => part.tokensPerMinute != null) ? {tokensPerMinute: parts.reduce((total, part) => total + part.tokensPerMinute, 0)} : {}), ...fields};
}

export function buildCostTree(q, scheme) {
  const b = q.breakdown, p = q.params, s = scheme.rates, T = p.minutes, K = b.responses;
  const realtime = q.mode === 'realtime', split = p.promptDesign === 'stage';
  const byom = q.modelOnDeployment;

  // ---- Drivers ----
  const perMinute = () => leaf('responses_per_minute', 'count', 'Responses per minute', K / T, `${num(K / T)} / min`, {
    op: 'formula', formula: 'K ÷ T, with K = ROUND((replies + tool calls) × T)', numbers: `${int(K)} ÷ ${num(T)} min`, visual: 'responses',
    explain: `Every response sends the instructions and the conversation so far. A response is a spoken reply or a tool (MCP) call; after a call the model responds again with the result. ${num(q.responsesPerMinute)} a minute makes ${int(K)} responses in a ${num(T)}-minute call.`,
    children: [
      leaf('replies_per_minute', 'input', 'Replies per minute', p.repliesPerMinute, `${num(p.repliesPerMinute)} / min`, {visual: 'responses',
        explain: 'Times a minute the agent answers the caller.'}),
      leaf('tool_calls_per_minute', 'input', 'Tool calls per minute', p.toolCallsPerMinute, `${num(p.toolCallsPerMinute)} / min`, {visual: 'responses',
        explain: 'Times a minute the agent calls a tool, for example to save an answer or look up a record. Each call is one more model response.'})]});
  const talk = (who, percent, perSecond, key) => product(`${key}_tokens`, 'tokens', `${who} audio`, 60, [
    share(`${key}_share`, 'Talk share', percent / 100, {visual: 'call_shape',
      explain: `Share of the call the ${who.toLowerCase()} talks. Caller ${num(p.callerTalkPercent)}%, agent ${num(p.agentTalkPercent)}%; the rest is silence and not billed.`}),
    leaf(`${key}_token_rate`, 'input', 'Tokens per second', perSecond, `${num(perSecond)} tokens/s`, {visual: 'new_audio',
      explain: 'One second of audio is billed as this many tokens.'})],
    {formula: '60 s × talk share × tokens per second', visual: 'new_audio', explain: 'Talk time is a share of the call, so it grows with call length.'});
  const callerAudio = () => talk('Caller', p.callerTalkPercent, p.inputAudioRate, 'caller');
  const system = () => leaf('system_prompt', 'input', 'System prompt', p.systemPromptTokens, `${int(p.systemPromptTokens)} tokens`, {visual: 'handoff',
    explain: 'Shared rules sent first with every response in every stage: persona, tone, consent wording, safety rules and stage routing. It never changes, so it stays cached across a handoff.'});
  const planResponses = split ? q.plan.reduce((total, node) => total + node.length, 0) : 0;
  const logic = () => split
    ? leaf('logic', 'tokens', 'Node logic', q.logicPerResponse, `${int(q.logicPerResponse)} tokens`, {op: 'formula',
      formula: 'each node logic × its responses, averaged over the call',
      numbers: `(${q.plan.map(node => `${int(node.logic)} × ${int(node.length)}`).join(' + ')}) ÷ ${int(planResponses)}`, visual: 'handoff',
      explain: 'Split into nodes, a request carries only the logic of the node handling it, and a handoff swaps it. Routing nodes of about 2 caller turns come first, the main node holds the middle and one end node takes the last turns, so the long history is handed off once, at the end. An if-else branch the call does not take still holds part of the logic. Each node gets the business logic in proportion to its responses, a branch counted like a routing node.',
      children: [
        leaf('logic_total', 'input', 'Business logic', p.logicTokens, `${int(p.logicTokens)} tokens`, {visual: 'handoff',
          explain: 'Questions, tools and checks of every node together.'}),
        ...q.plan.map((node, index) => leaf(`node_${index + 1}`, 'input', `Node ${index + 1}, ${node.role === 'branch' ? 'if-else branch, not taken' : node.role}`, node.logic, `${int(node.logic)} tokens`, {visual: 'handoff',
          explain: node.role === 'branch' ? 'An if-else branch this call does not take: it holds its share of the logic, sized like a routing node, but never runs, so it adds no handoff.'
            : `Responses ${int(node.start + 1)}–${int(node.start + node.length)} of ${int(planResponses)}. Its share of the business logic follows its share of the responses.`}))]})
    : leaf('logic', 'input', 'Business logic', p.logicTokens, `${int(p.logicTokens)} tokens`, {visual: 'request',
      explain: 'One mixed prompt: every request carries the business logic of all stages.'});
  const instructionsPerResponse = () => ({key: 'per_response', kind: 'tokens', label: 'Per response', value: q.instructions,
    display: `${int(q.instructions)} tokens`, op: 'sum', formula: 'system prompt + business logic',
    numbers: `${int(p.systemPromptTokens)} + ${int(q.instructions - p.systemPromptTokens)}`, visual: split ? 'handoff' : 'request',
    explain: split ? 'The system prompt plus the logic of the node handling the response, averaged over the call.' : 'The system prompt plus the business logic of all stages in one block.',
    children: [system(), logic()]});
  // Text the conversation grows by per response, averaged over replies and tool calls.
  const perTurnValue = q.sharedHistory + p.messageOverheadTokens;
  const perTurn = () => {
    const part = (key, label, value, explain) => leaf(key, 'input', label, value, `${int(value)} tokens`, {visual: 'request', explain});
    return {key: 'per_turn', kind: 'tokens', label: 'Added per response', value: perTurnValue, display: `${num(perTurnValue, 1)} tokens`,
      op: 'formula', formula: '(replies × reply + tool calls × (arguments + result)) ÷ responses + overhead',
      numbers: `(${num(p.repliesPerMinute)} × ${int(p.replyTokens)} + ${num(p.toolCallsPerMinute)} × (${int(p.toolCallTokens)} + ${int(p.toolResultTokens)})) ÷ ${num(q.responsesPerMinute)} + ${int(p.messageOverheadTokens)}`,
      visual: 'request', explain: 'What the conversation grows by per response, averaged over replies and tool calls. A tool result stays in the history and is read again on every later response.',
      children: [
        part('reply_tokens', 'Reply', p.replyTokens, 'Text of one spoken reply; it stays in the history as text.'),
        part('tool_call_tokens', 'Tool arguments', p.toolCallTokens, 'Tool name and JSON arguments of one call.'),
        part('tool_result_tokens', 'Tool result', p.toolResultTokens, 'What one call returns; it is read again on every later response.'),
        part('overhead_tokens', 'Overhead', p.messageOverheadTokens, 'Roles and message formatting.')]};
  };

  // ---- Cached input: the start of each request that matches the previous one, from the walk ----
  // [label, diagram, what sets its size]. Audio history sits under Audio, so it is just "History" there.
  const WHAT = {instructions: ['Instructions', split ? 'handoff' : 'instructions', instructionsPerResponse],
    history: ['History', 'text_history', perTurn], audio: ['History', 'audio_reread', callerAudio]};
  const walked = (key, label, tokens, visual, explain, drivers) => ({key, kind: 'tokens', label, value: tokens / T, display: tpm(tokens / T),
    op: 'formula', formula: 'tokens in the call, added up response by response ÷ call length', numbers: `${int(tokens)} ÷ ${num(T)} min`,
    visual, explain, children: drivers});
  const cachedItem = what => {
    const [label, visual, driver] = WHAT[what];
    const audio = what === 'audio';
    const rateNode = perMillion('cached_rate', audio ? 'Cached audio rate' : 'Cached text rate', audio ? s.audioCached ?? s.textCached : s.textCached);
    const tokens = walked('tokens', 'Cached tokens', b.cached[what].tokens, visual,
      'The start of each request that matches the previous request, counted in whole 128-token blocks.', [driver()]);
    return product(audio ? 'history' : what, 'cost', label, CENTS, [tokens, rateNode], {formula: `cached tokens × ${lower(rateNode.label)}`,
      visual, explain: 'Sent before and the same as the start of the previous request, so it is billed at the cached rate.'});
  };
  const cachedItems = whats => whats.filter(what => b.cached[what].tokens > 0).map(cachedItem);

  // ---- Uncached input, one item per reason it pays the full rate; each is one total of the walk (b.missBy) ----
  const ROUNDING = 'The cache keeps the previous request in whole 128-token blocks, so the last part that does not fill a block is sent again at the full rate.';
  const missedItems = audio => {
    const m = b.missBy;
    const rows = audio ? [
      ['rounding', 'Cache rounding', m.roundingAudio, 'audio_reread', `${ROUNDING} In a realtime call that tail is the caller audio of the previous turn.`, []],
      ['handoff', 'After handoff', m.handoffAudio, 'handoff', 'Earlier caller audio behind a handoff: the new node changes the start of the request, so it is billed at the full rate once.', [callerAudio()]],
      ['compaction', 'After compaction', m.compactionAudio, 'compaction', 'Caller audio kept after a compaction: the history is rewritten, so it is billed at the full rate once.', [callerAudio()]],
    ] : [
      ['instructions', 'Instructions', m.instructions, split ? 'handoff' : 'instructions', split
        ? 'Sent for the first time: the whole prompt in the first request, and the logic of each node when that node takes over. After that it is cached.'
        : 'Sent for the first time with the first request of the call. After that it is cached.', [instructionsPerResponse()]],
      ['reply', 'New reply', m.reply, 'text_history', 'What the agent wrote in the previous response (a reply, or a tool call and its result), sent back as input for the first time.', [perTurn()]],
      ['rounding', 'Cache rounding', m.roundingText, 'text_history', ROUNDING, []],
      ['handoff', 'After handoff', m.handoffText, 'handoff', 'History behind a handoff: the new node changes the start of the request, so the history is billed at the full rate once.', [perTurn()]],
      ['compaction', 'After compaction', m.compactionText, 'compaction', 'The summary and the turns kept after a compaction: the history is rewritten, so it is billed at the full rate once.', [perTurn()]],
      ['fallback', 'Cache fallback', m.fallback, 'cache', `Measured on Cascade: about ${split ? '40' : '20'}% of requests fall back to caching only the static prompt, and a few miss entirely.`, []],
    ];
    return rows.filter(([, , entry]) => entry && entry.tokens > 1e-6).map(([key, label, entry, visual, explain, drivers]) => {
      const rateNode = perMillion('input_rate', audio ? 'Audio input rate' : 'Text input rate', audio ? s.audioInput : s.textInput);
      const tokens = walked('tokens', 'Uncached tokens', entry.tokens, visual, explain, drivers);
      return product(key, 'cost', label, CENTS, [tokens, rateNode], {formula: `uncached tokens × ${lower(rateNode.label)}`, visual, explain});
    });
  };

  // ---- The four lines ----
  const lines = [];
  lines.push(product('stt', 'cost', 'STT', CENTS, [callerAudio(), perMillion('stt_rate', 'STT rate', b.speechIn.rate, {visual: 'new_audio'})],
    {formula: 'caller audio per minute × STT rate', visual: 'new_audio', explain: byom
      ? 'A BYOM session always transcribes the caller, on realtime models too: STT at the BYO rate.'
      : realtime ? "A realtime model hears the caller's audio itself (model input), and STT runs beside it so barge-in works: the caller can talk over the agent and stop it at once. Billed at the tier's STT rate."
      : 'STT turns each second of the caller into text once.'}));
  lines.push(product('tts', 'cost', 'TTS', CENTS,
    [talk('Agent', p.agentTalkPercent, p.outputAudioRate, 'agent'), perMillion('voice_rate', 'TTS rate', s.audioOutput, {visual: 'new_audio'})],
    {formula: 'agent audio per minute × TTS rate', visual: 'new_audio', explain: 'TTS reads every reply aloud with an Azure HD voice.'}));

  const summaries = b.summaries.count > 0 ? leaf('summaries', 'cost', 'Compaction', b.summaries.usd / T * 100, cpm(b.summaries.usd / T * 100), {
    op: 'formula', formula: 'summaries per call × cost of one summary ÷ call length', numbers: `${int(b.summaries.count)} × ${usd(SUMMARY_USD, 5)} ÷ ${num(T)} min`,
    visual: 'compaction', explain: `A separate small text model writes each summary (about 800 tokens in, 160 out). ${split ? 'One at each handoff.' : `One every ${int(p.compactEveryTurns)} caller turns, keeping the last 2.`}`}) : null;

  if (!byom) {
    // Model input = uncached + cached, each split the way the price card bills input: audio and text. In request
    // order: instructions, history, then the new audio (its transcript on Cascade). Text models take no audio, so on Cascade the parts sit
    // directly under uncached and cached.
    const newAudio = b.firstTime.audio.tokens > 0 ? product('new', 'cost', 'New audio', CENTS,
      [callerAudio(), perMillion('input_rate', 'Audio input rate', s.audioInput, {visual: 'new_audio'})],
      {formula: 'caller audio × audio input rate', visual: 'new_audio', explain: "What the caller has just said. A realtime model hears it as audio, so it is billed at the audio input rate. Nothing sent before matches it, so it is never cached."}) : null;
    const newText = b.firstTime.text.tokens > 0 ? product('new', 'cost', realtime ? 'New audio framing' : 'New transcript', CENTS, [
      walked('tokens', realtime ? 'Framing tokens' : 'Transcript tokens', b.firstTime.text.tokens, 'new_audio', realtime
        ? 'A few tokens that frame each caller message.' : "The caller's words as text from STT, plus message framing: transcript tokens per second × talk time.",
        [callerAudio()]), perMillion('input_rate', 'Text input rate', s.textInput, {visual: 'new_audio'})],
      {formula: `${realtime ? 'framing' : 'transcript'} tokens × text input rate`, visual: 'new_audio', explain: realtime ? "The few text tokens that wrap the new audio in the request. Never cached."
        : "What the caller has just said, as text from STT. Nothing sent before matches them, so they are never cached."}) : null;
    const modality = (key, label, parts, explain) => parts.length === 1 ? {...parts[0], key, label}
      : sum(key, label, parts, {formula: parts.map(part => lower(part.label)).join(' + '), visual: 'cache', explain});
    // Uncached: what is sent for the first time, then what the cache could not hold. Cached: what matched.
    const textMissed = missedItems(false), first = ['instructions', 'reply'];
    const uncachedText = [...textMissed.filter(item => first.includes(item.key)), newText, ...textMissed.filter(item => !first.includes(item.key))].filter(Boolean);
    const uncachedAudio = [newAudio, ...missedItems(true)].filter(Boolean);
    const input = (key, label, audio, text, explain, audioExplain, textExplain) => {
      const parts = realtime ? [audio.length ? modality('audio', 'Audio', audio, audioExplain) : null,
        text.length ? modality('text', 'Text', text, textExplain) : null].filter(Boolean) : text;
      return sum(key, label, parts, {formula: parts.map(part => lower(part.label)).join(' + ') || '0', visual: 'cache', explain});
    };
    lines.push(sum('model_input', 'Model input', [
      input('uncached', 'Uncached input', uncachedAudio, uncachedText,
        'Input billed at the full rate: what is sent for the first time (the first instructions, each node logic when it takes over, the new audio, the agent reply), and what the cache could not hold (the tail under a 128-token block, and what sits behind a handoff or a compaction, once).',
        'Caller audio at the audio input rate: the new audio, and earlier audio the cache could not hold.',
        'Text at the text input rate: what is sent for the first time, and what the cache could not hold.'),
      input('cached', 'Cached input', cachedItems(['audio']), cachedItems(['instructions', 'history']),
        'Everything sent before that matches the start of the previous request, in 128-token blocks, billed at the cached rate.',
        'Earlier caller audio that matches the previous request, at the cached audio rate.',
        'Instructions and history that match the previous request, at the cached text rate.')],
    {formula: 'uncached input + cached input', visual: 'request',
      explain: 'Every response sends the instructions first, then the history, then the new caller speech. The start that matches the previous request is cached and billed at the cached rate; the rest is uncached and pays the full rate.'}));

    const outputLine = (key, label, tokens, explain) => product(key, 'cost', label, CENTS,
      [tokens, perMillion('output_rate', 'Text output rate', s.textOutput, {visual: 'responses'})], {formula: 'tokens per minute × output rate', visual: 'responses', explain});
    const outputTokens = (key, label, factors, formula) => product(`${key}_tokens`, 'tokens', `${label} tokens`, 1, [perMinute(), ...factors],
      {formula, visual: 'responses', explain: 'Written once per response and never cached.'});
    const each = (key, label, value, explain) => leaf(key, 'input', label, value, `${int(value)} tokens`, {visual: 'responses', explain});
    const outputs = [];
    if (q.replyShare > 0) outputs.push(outputLine('replies', 'Replies', outputTokens('replies', 'Reply', [
      share('reply_share', 'Reply share', q.replyShare, {visual: 'responses', explain: 'Replies ÷ (replies + tool calls).'}),
      each('reply_each', 'Tokens per reply', p.replyTokens, 'Text of one spoken reply.')], 'responses per minute × reply share × tokens per reply'),
      'The text of every spoken reply, at the text output rate. TTS then reads it aloud.'));
    const tools = [];
    if (q.toolShare > 0) tools.push(outputLine('tool_arguments', 'Tool arguments', outputTokens('tool_arguments', 'Tool argument', [
      share('tool_share', 'Tool call share', q.toolShare, {visual: 'responses', explain: 'Tool calls ÷ (replies + tool calls).'}),
      each('tool_call_each', 'Tokens per call', p.toolCallTokens, 'Tool name and JSON arguments of one call.')], 'responses per minute × tool share × tokens per call'),
      'Calling a tool writes its name and JSON arguments, billed as text output. The result comes back as model input and stays in the history.'));
    if (b.output.handoffs.tokens > 0) tools.push(outputLine('handoff_calls', 'Handoff calls', walked('handoff_tokens', 'Handoff tokens', b.output.handoffs.tokens, 'handoff',
      `${int(b.handoffs)} handoffs, each one extra response that writes a ${int(PROFILE.handoffCallTokens)}-token function call.`, []),
      'Each handoff is a function call by the source node: one more response that re-reads its prompt and writes the call.'));
    if (tools.length === 1) outputs.push({...tools[0], key: 'tools', label: 'Tool calls'});
    else if (tools.length) outputs.push(sum('tools', 'Tool calls', tools, {formula: 'tool arguments + handoff calls', visual: 'responses',
      explain: 'Function calls the model writes: tool (MCP) arguments and handoff calls, at the text output rate.'}));
    if (p.reasoningTokens > 0) outputs.push(outputLine('reasoning', 'Reasoning', outputTokens('reasoning', 'Reasoning', [
      each('reasoning_each', 'Tokens per response', p.reasoningTokens, 'Hidden thinking before a response.')], 'responses per minute × reasoning per response'),
      'Hidden reasoning, billed as text output and not kept in the history.'));
    if (summaries) outputs.push(summaries);
    lines.push(sum('model_output', 'Model output', outputs, {formula: outputs.map(item => lower(item.label)).join(' + '), visual: 'responses',
      explain: 'Everything the model writes, at the text output rate: replies and tool calls (MCP and handoff). Written once, never cached.'
        + (summaries ? ' Compaction summaries are written by a separate small model.' : '')}));
  }

  const root = sum('price', byom ? 'Voice-agent cost per minute' : 'Price per minute', lines, {formula: lines.map(line => lower(line.label)).join(' + '), visual: 'totals',
    explain: (byom ? 'This is the voice-agent cost of one minute at list price, the STT and TTS the voice agent bills; the model is extra, billed on your own deployment (pay-as-you-go or PTU), and not included. Each line below is worked out per minute.'
      : 'This is what one minute of the call costs at list price, the sum of the lines below, each worked out per minute.') + ' Click a line to see what it is made of.'});
  delete root.tokensPerMinute; // speech, model input and model output tokens do not add up to one useful number
  return assignIds(root);
}

function assignIds(item, parent = null) {
  item.id = parent ? `${parent.id}.${item.key}` : item.key;
  item.series = SERIES[item.key] ?? parent?.series ?? null;
  for (const child of item.children) assignIds(child, item);
  return item;
}

export function allNodes(root) {
  const all = [];
  const walk = item => { all.push(item); item.children.forEach(walk); };
  walk(root);
  return all;
}
export const findNode = (root, id) => allNodes(root).find(item => item.id === id) ?? null;

// Answer first: the price, then each cost line from largest to smallest, and the largest part of the two
// largest lines.
export function narrationOrder(root) {
  const order = [root.id];
  [...root.children].filter(line => line.value > 0).sort((a, b) => b.value - a.value).forEach((line, index) => {
    order.push(line.id);
    if (index < 2 && line.op === 'sum' && line.children.length > 1) order.push([...line.children].sort((a, b) => b.value - a.value)[0].id);
  });
  return order;
}
