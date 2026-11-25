// Pricing options: what the voice agent bills for every model and hosting the page can price, as USD list prices
// per 1M tokens. audioInput is native audio input on realtime models and STT on text models; sttInput is the STT
// that runs beside a realtime model so barge-in works (the caller can talk over the agent and stop it); audioOutput
// is TTS, the HD voice that reads the reply. From the Azure Retail Prices snapshot in voice-agent
// tools/cost_calculator/prices.json (retrieved 2026-10-22, centralindia): the API Pro / Std / Lite meters for managed
// models (STT is each tier's Standard Speech Audio Input) and the BYO meters for BYOM. Native speech-to-speech output
// and GPT Live are not listed: the measured walk does not cover them.
//
// Two hostings, split by who bills the model:
//   managed  the voice agent hosts the model and bills its tokens at the tier rate, with STT and TTS.
//   byom     the model is the customer's own Foundry deployment and is billed there (pay-as-you-go or PTU, the
//            customer's choice); the voice agent bills no model tokens, only STT and TTS. A BYOM session always
//            transcribes the caller, so STT is billed on realtime models too.
export const RATES_AS_OF = '2026-10-22';

export const MODELS = Object.freeze([
  // Microsoft-hosted realtime models: managed only (no BYOM deployment of them exists).
  {"id":"azure-realtime","name":"Azure Realtime","realtime":true,"byom":false},
  {"id":"microsoft-realtime-flash-1","name":"Microsoft Realtime Flash","realtime":true,"byom":false},
  {"id":"gpt-realtime-2.1","name":"GPT Realtime 2.1","realtime":true},
  {"id":"gpt-realtime-2.1-mini","name":"GPT Realtime 2.1 mini","realtime":true},
  {"id":"gpt-realtime","name":"GPT Realtime 1.0 (gpt-realtime)","realtime":true},
  {"id":"gpt-realtime-1.5","name":"GPT Realtime 1.5","realtime":true},
  {"id":"gpt-4.1","name":"GPT-4.1","realtime":false},
  {"id":"gpt-4.1-mini","name":"GPT-4.1 mini","realtime":false},
  {"id":"gpt-4.1-nano","name":"GPT-4.1 nano","realtime":false},
  {"id":"gpt-5.6-luna","name":"GPT-5.6 Luna","realtime":false},
  {"id":"gpt-6-luna","name":"GPT-6 Luna","realtime":false},
  {"id":"gpt-5.4","name":"GPT-5.4","realtime":false},
  {"id":"gpt-5.4-mini","name":"GPT-5.4 mini","realtime":false},
  {"id":"gpt-5.4-nano","name":"GPT-5.4 nano","realtime":false},
  {"id":"gpt-5.2","name":"GPT-5.2","realtime":false},
  {"id":"gpt-5.1","name":"GPT-5.1","realtime":false},
  {"id":"gpt-oss-120b","name":"GPT OSS 120B","realtime":false},
  {"id":"gpt-6-sol","name":"GPT-6 Sol","realtime":false},
]);

// BYO Standard Speech Audio Input / Output Tokens: the same for every BYOM model.
export const BYO_SPEECH = Object.freeze({audioInput: 12.5, audioOutput: 23});

// azure-realtime and microsoft-realtime-flash-1: tiers from Voice Live configs/model-config.json model_tiers (pro and
// lite) and their meters from configs/meter-config.yaml (voice-agent-orchestrator main, 2026-11-20), priced at the
// Voice Live API Pro / Lite meters. Flash bills the caller's audio at one token per 80 ms (12.5 a second) and speaks
// with an Azure HD voice (Standard Speech output), with STT beside it. Azure Realtime speaks itself: no STT is
// billed and the agent's voice is LLM Audio Output (nativeVoice).
const MANAGED = [
  {"model":"azure-realtime","mode":"realtime","tier":"Pro tier","nativeVoice":true,"rates":{"textInput":4,"textCached":0.4,"textOutput":16,"audioInput":32,"audioOutput":64,"sttInput":0,"audioCached":0.4}},
  {"model":"microsoft-realtime-flash-1","mode":"realtime","tier":"Lite tier","audioTokensPerSecond":12.5,"rates":{"textInput":0.11,"textCached":0.04,"textOutput":0.44,"audioInput":4,"audioOutput":25,"sttInput":15,"audioCached":0.04}},
  {"model":"gpt-realtime-2.1","mode":"realtime","tier":"Pro tier","rates":{"textInput":4,"textCached":0.4,"textOutput":24,"audioInput":32,"audioOutput":31,"sttInput":17,"audioCached":0.4}},
  {"model":"gpt-realtime-2.1-mini","mode":"realtime","tier":"Standard tier","rates":{"textInput":0.66,"textCached":0.33,"textOutput":2.64,"audioInput":11,"audioOutput":26,"sttInput":15,"audioCached":0.33}},
  {"model":"gpt-realtime","mode":"realtime","tier":"Pro tier","rates":{"textInput":4,"textCached":0.4,"textOutput":16,"audioInput":32,"audioOutput":31,"sttInput":17,"audioCached":0.4}},
  {"model":"gpt-realtime-1.5","mode":"realtime","tier":"Pro tier","rates":{"textInput":4,"textCached":0.4,"textOutput":16,"audioInput":32,"audioOutput":31,"sttInput":17,"audioCached":0.4}},
  {"model":"gpt-4.1","mode":"speech","tier":"Pro tier","rates":{"textInput":4,"textCached":0.4,"textOutput":16,"audioInput":17,"audioOutput":31}},
  {"model":"gpt-4.1-mini","mode":"speech","tier":"Standard tier","rates":{"textInput":0.66,"textCached":0.33,"textOutput":2.64,"audioInput":15,"audioOutput":26}},
  {"model":"gpt-4.1-nano","mode":"speech","tier":"Lite tier","rates":{"textInput":0.11,"textCached":0.04,"textOutput":0.44,"audioInput":15,"audioOutput":25}},
  {"model":"gpt-5.6-luna","mode":"speech","tier":"Standard tier","rates":{"textInput":0.66,"textCached":0.33,"textOutput":2.64,"audioInput":15,"audioOutput":26}},
  {"model":"gpt-6-luna","mode":"speech","tier":"Lite tier","rates":{"textInput":0.11,"textCached":0.04,"textOutput":0.44,"audioInput":15,"audioOutput":25}},
  {"model":"gpt-5.4","mode":"speech","tier":"Pro tier","rates":{"textInput":4,"textCached":0.4,"textOutput":16,"audioInput":17,"audioOutput":31}},
  {"model":"gpt-5.2","mode":"speech","tier":"Pro tier","rates":{"textInput":4,"textCached":0.4,"textOutput":16,"audioInput":17,"audioOutput":31}},
  {"model":"gpt-5.1","mode":"speech","tier":"Pro tier","rates":{"textInput":4,"textCached":0.4,"textOutput":16,"audioInput":17,"audioOutput":31}},
  {"model":"gpt-6-sol","mode":"speech","tier":"Pro tier","rates":{"textInput":4,"textCached":0.4,"textOutput":16,"audioInput":17,"audioOutput":31}},
];

// Each model's managed option (where the voice agent hosts it), then its BYOM option.
export const COMBOS = Object.freeze(MODELS.flatMap(model => [
  ...MANAGED.filter(combo => combo.model === model.id).map(combo => ({...combo, hosting: 'managed'})),
  ...(model.byom === false ? [] : [{model: model.id, hosting: 'byom', mode: 'byom', tier: 'BYO speech', rates: BYO_SPEECH}]),
]));

function toScheme(combo) {
  const model = MODELS.find(item => item.id === combo.model);
  const byom = combo.hosting === 'byom';
  return Object.freeze({
    id: `${combo.model}@${combo.hosting}`, model: combo.model, hosting: combo.hosting, mode: combo.mode, tier: combo.tier,
    name: model.name + (byom ? ', BYOM' : ''),
    subtitle: byom ? 'STT · TTS (Azure HD voice) · model billed on your deployment'
      : combo.nativeVoice ? 'Native audio in · the model speaks itself (native voice)'
      : combo.mode === 'realtime' ? 'Native audio in · STT for barge-in · TTS (Azure HD voice)' : 'STT · TTS (Azure HD voice)',
    pipeline: combo.nativeVoice ? 'Native' : model.realtime ? 'Hybrid' : 'Cascade', rates: combo.rates,
    // The model's audio input tokens per second, when not the page's input; and whether the model speaks itself.
    audioTokensPerSecond: combo.audioTokensPerSecond ?? null, nativeVoice: Boolean(combo.nativeVoice),
  });
}

export const SCHEMES = Object.freeze(COMBOS.map(toScheme));
// The standard options on the page, Azure Realtime first (the page opens on it); every other combination is under Custom.
export const PRESETS = Object.freeze(['azure-realtime@managed', 'microsoft-realtime-flash-1@managed', 'gpt-realtime-2.1@managed',
  'gpt-realtime-2.1-mini@managed', 'gpt-6-luna@managed']);
// Short option names, kept for the tests and the Agent.
const ALIASES = Object.freeze({
  'rt21-pro': 'gpt-realtime-2.1@managed', 'rt21-mini-std': 'gpt-realtime-2.1-mini@managed', 'pro-speech': 'gpt-4.1@managed',
  'std-speech': 'gpt-5.6-luna@managed', 'lite-speech': 'gpt-6-luna@managed', 'luna6-byom': 'gpt-6-luna@byom',
});

export function schemeById(id) {
  const scheme = SCHEMES.find(item => item.id === (ALIASES[id] ?? id));
  if (!scheme) throw new Error(`Unknown option: ${id}. Options are model@hosting, for example gpt-realtime-2.1@managed or gpt-4.1@byom.`);
  return scheme;
}

export const hostingsFor = model => SCHEMES.filter(scheme => scheme.model === model).map(scheme => scheme.hosting);
