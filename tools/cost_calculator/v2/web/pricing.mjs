// The voice-agent cost of one call, grouped by line:
//   STT (caller audio to text), TTS (the HD voice),
//   model input (new audio, re-sent and uncached, re-sent and cached),
//   model output (replies, tool and handoff calls, reasoning, summaries).
// Managed: the voice agent bills all four; on a realtime model STT runs beside the model so barge-in works. BYOM: the model is billed on the customer's own deployment (pay-as-you-go or
// PTU, their choice) and is not priced here; the voice agent bills only STT and TTS, and a BYOM session always
// transcribes the caller, so STT is billed on realtime models too.
// One algorithm: the call is walked response by response (response-model.mjs, calibrated on the team's live
// calls), so handoffs and compactions break the cache where they really do. Every amount is USD per call.
import {callDrivers} from './inputs.mjs';
import {SUMMARY_USD, simulate} from './response-model.mjs';

export const LINES = Object.freeze([
  {key: 'stt', label: 'STT', series: 's1'},
  {key: 'tts', label: 'TTS', series: 's2'},
  {key: 'model_input', label: 'Model input', series: 's3'},
  {key: 'model_output', label: 'Model output', series: 's4'},
]);
// The TTS line's label on a model that speaks itself (nativeVoice: Azure Realtime); such a model has no STT line.
export const VOICE_LABEL = 'Voice (model audio)';
// What a BYOM price leaves out, wherever the page or the Agent states that price.
export const BYOM_EXTRA = 'model on your deployment';

const item = (tokens, rate) => ({tokens, rate, usd: tokens * rate / 1e6});
const none = () => item(0, 0);
const total = group => Object.values(group).reduce((sum, part) => sum + part.usd, 0);
const tokens = group => Object.values(group).reduce((sum, part) => sum + part.tokens, 0);

// The walk's inputs from the page's inputs. A prompt split by stage has one node per stage; compaction is S1 (at
// each handoff) with a split prompt and periodic (every compactEveryTurns caller turns, 10 by default, keep 2) with one prompt.
export function walkProfile(d, scheme = null) {
  const p = d.params;
  const split = p.promptDesign === 'stage';
  return {
    ...(scheme?.audioTokensPerSecond ? {modelAudioRate: scheme.audioTokensPerSecond} : {}),
    pipeline: d.mode === 'realtime' ? 'realtime' : 'cascade', minutes: p.minutes, respPerMin: d.responsesPerMinute,
    userTalk: p.callerTalkPercent / 100, agentTalk: p.agentTalkPercent / 100, stages: p.stages, nodes: split ? p.stages : 1,
    sysTokens: p.systemPromptTokens, stageTokens: p.logicTokens / p.stages, logicTokens: p.logicTokens, branchNodes: p.branchNodes, periodicEvery: p.compactEveryTurns, outTextPerResp: d.outputPerResponse,
    histTextPerResp: d.sharedHistory + p.messageOverheadTokens, transcriptTokPerS: p.transcriptTokensPerSecond,
    strategy: !p.summarise ? 'none' : split ? 's1' : 'periodic',
    respPerTurn: p.repliesPerMinute > 0 ? d.responsesPerMinute / p.repliesPerMinute : 1,
    inAudioRate: p.inputAudioRate, outAudioRate: p.outputAudioRate,
    ...(p.cascadeCacheFallback ? {} : {cascadeFallbackFlat: 0, cascadeZeroFlat: 0, cascadeFallbackHandoff: 0, cascadeZeroHandoff: 0}),
  };
}

function breakdown(d, scheme) {
  const p = d.params, s = scheme.rates;
  const realtime = d.mode === 'realtime', byom = d.mode === 'byom';
  const t = simulate(walkProfile(d, scheme));
  const K = t.kTotal;
  const b = {
    walk: t, responses: K, handoffs: t.handoffs,
    // A model that speaks itself bills no STT; its voice is the model's audio output, in speechOut at that rate.
    speechIn: scheme.nativeVoice ? none() : item(t.callerAudioTokens, realtime ? s.sttInput : s.audioInput),
    speechOut: item(t.agentAudioTokens, s.audioOutput),
    firstTime: {audio: none(), text: none()},
    miss: {instructions: none(), history: none(), audio: none()},
    cached: {instructions: none(), history: none(), audio: none()},
    missBy: {},
    output: {replies: none(), tools: none(), handoffs: none(), reasoning: none()},
    // No model tokens are billed on BYOM, the summaries included.
    summaries: {count: t.compactions, usd: byom ? 0 : t.compactions * SUMMARY_USD},
  };
  if (byom) return b;
  b.firstTime = {audio: item(t.newAud, s.audioInput), text: item(t.newTxt, s.textInput)};
  // No cache hit rate goes in: each request is cached up to where it matches the previous one, and handoffs happen
  // at fixed points in the walk (one per stage change). The hit rate the page shows comes out of the walk.
  b.miss = {instructions: item(t.uncStatic, s.textInput), history: item(t.uncHistTxt, s.textInput), audio: item(t.uncHistAud, s.audioInput)};
  // The same uncached tokens by why they pay the full rate, as the cost tree lists them; they add up to b.miss.
  const w = t.why;
  b.missBy = {instructions: item(w.new.st, s.textInput), reply: item(w.new.txt, s.textInput),
    roundingText: item(w.rounding.st + w.rounding.txt, s.textInput), roundingAudio: item(w.rounding.aud, s.audioInput),
    handoffText: item(w.handoff.st + w.handoff.txt, s.textInput), handoffAudio: item(w.handoff.aud, s.audioInput),
    compactionText: item(w.compaction.st + w.compaction.txt, s.textInput), compactionAudio: item(w.compaction.aud, s.audioInput),
    fallback: item(w.fallback.st + w.fallback.txt + w.fallback.aud, s.textInput)};
  b.cached = {instructions: item(t.cachedStatic, s.textCached), history: item(t.cachedHistTxt, s.textCached),
    audio: item(t.cachedHistAud, s.audioCached ?? s.textCached)};
  const outputTokens = {replies: K * d.replyShare * p.replyTokens, tools: K * d.toolShare * p.toolCallTokens,
    handoffs: t.outHandoff, reasoning: K * p.reasoningTokens};
  b.output = Object.fromEntries(Object.entries(outputTokens).map(([key, value]) => [key, item(value, s.textOutput)]));
  return b;
}

export function priceCall(params, scheme) {
  const d = callDrivers(params, scheme);
  const p = d.params, T = p.minutes;
  const b = breakdown(d, scheme);
  const modelOnDeployment = d.mode === 'byom';
  const values = {stt: b.speechIn.usd, tts: b.speechOut.usd,
    model_input: total(b.firstTime) + total(b.miss) + total(b.cached), model_output: total(b.output) + b.summaries.usd};
  const lines = LINES.map(line => ({...line, value: values[line.key], ...(scheme.nativeVoice && line.key === 'tts' ? {label: VOICE_LABEL} : {})}))
    .filter(line => !(modelOnDeployment && line.key.startsWith('model_')) && !(scheme.nativeVoice && line.key === 'stt'));
  const perCall = lines.reduce((sum, line) => sum + line.value, 0);
  const audio = b.speechIn.usd + b.speechOut.usd + b.firstTime.audio.usd + b.miss.audio.usd + b.cached.audio.usd;
  const inputTokens = tokens(b.firstTime) + tokens(b.miss) + tokens(b.cached);
  const cachedTokens = tokens(b.cached), resent = cachedTokens + tokens(b.miss);
  const monthly = perCall * p.monthlyCalls, factor = d.localFactor;
  return {
    ...d, breakdown: b, lines, perCall, perMinute: perCall / T, monthly, annual: monthly * 12,
    // BYOM: the price is the voice-agent cost only; the model is extra, on the customer's deployment.
    modelOnDeployment, extra: modelOnDeployment ? BYOM_EXTRA : null,
    audioShare: perCall ? audio / perCall : 0,
    cacheShare: inputTokens ? cachedTokens / inputTokens : 0, resentHitShare: resent ? cachedTokens / resent : 0,
    local: {currency: p.currency, factor, perCall: perCall * factor, perMinute: perCall / T * factor,
      monthly: monthly * factor, annual: monthly * 12 * factor},
  };
}
