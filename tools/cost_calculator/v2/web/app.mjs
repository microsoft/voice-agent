// The cost page: choose an option and inputs, see the cost per minute broken down in a tree and the bill, both
// live, and open the ways to pay less from the right edge. The voice guide explains the numbers and drives the
// same functions a visitor's clicks do.
import {DEFAULTS} from './inputs.mjs';
import {priceCall} from './pricing.mjs';
import {MODELS, PRESETS, RATES_AS_OF, hostingsFor, schemeById} from './rate-card.mjs';
import {format} from './steps.mjs';
import {settingsFromQuery, settingsQuery, settingsUrl} from './share.mjs';
import {costWorkbook, exportFileName} from './export.mjs';
import {allNodes, buildCostTree, findNode} from './cost-tree.mjs';
import {CONCEPT_TEXT} from './concepts.mjs';
import {Stage, motionAllowed} from './stage.mjs';
import {assumptions, attachTooltip, comparisonIds, rankOptions, rankingSummary, renderBill, renderCompare, renderCurve, renderSavings, renderTiles} from './result.mjs';
import {PageTools} from './page-tools.mjs';
import {VoiceGuide} from './voice.mjs';
import {WireOrb} from './wireframe.mjs';
import * as fx from './effects.mjs';

const $ = id => document.getElementById(id);
const {int, num, cents, rate, pct} = format;
const node = (tag, cls = '', text) => {
  const element = document.createElement(tag);
  if (cls) element.className = cls;
  if (text !== undefined) element.textContent = text;
  return element;
};

// custom: the last option chosen on the Custom card, kept while a standard option is selected.
const state = {option: PRESETS[0], custom: 'gpt-5.6-luna@managed', params: {...DEFAULTS}, walkthrough: null, result: null};
const stage = new Stage($('stage'));
let guide = null;
// Two hostings, split by who bills the model. The page prices only what the voice agent bills (the voice-agent cost).
const HOSTING_LABEL = {managed: 'Managed', byom: 'BYOM'};
// What each hosting means and what its price includes, for the ? next to the hosting buttons.
const HOSTING_HELP = {
  managed: 'Managed: the voice agent hosts the model. Everything is on one bill: model tokens at the tier rate (Pro, Standard or Lite), plus STT and TTS. The price shown is the whole cost.',
  byom: 'BYOM (bring your own model): the voice agent calls a model you deployed in your own Foundry resource. It bills no model tokens, only STT and TTS at the BYO rate, the same for every model, and it always transcribes the caller (STT on realtime models too). The model is billed on your deployment, pay-as-you-go or PTU as you choose, and is not priced here: the price shown is the voice-agent cost, plus your model cost.',
};

// Less common inputs, under "All assumptions": [key, label, step, min, max] or [key, label, choices].
const ADVANCED = [
  ['repliesPerMinute', 'Spoken replies per minute', .1, 0, 20], ['replyTokens', 'Reply tokens', 1, 0, 4000],
  ['toolCallTokens', 'Tool call arguments, tokens per call', 1, 0, 4000], ['toolResultTokens', 'Tool result, tokens per call', 1, 0, 20000],
  ['reasoningTokens', 'Reasoning tokens per response', 1, 0, 4000],
  ['transcriptTokensPerSecond', 'STT transcript tokens per second of caller speech', .1, 0, 20],
  ['messageOverheadTokens', 'Message overhead per response', 1, 0, 1000], ['inputAudioRate', 'Input audio tokens per second', 1, 1, 100],
  ['outputAudioRate', 'Output audio tokens per second', 1, 1, 100],
  ['cascadeCacheFallback', 'Cascade cache fallback as measured', [['on', true], ['off', false]]],
  ['compactEveryTurns', 'One prompt: compact every N caller turns', 1, 1, 100], ['branchNodes', 'Split prompt: if-else branch nodes not taken', 1, 0, 10], ['monthlyCalls', 'Calls per month', 1, 1, 100000000],
  ['currency', 'Show also in', ['USD', 'INR']],
  ['fxRate', 'USD to INR', .01, .01, 1000], ['discountPercent', 'Discount (%)', .1, 0, 100],
];
// Which control an Agent change lights up.
const KNOB = {minutes: 'knob-minutes', prompt_design: 'knob-prompt', system_prompt_tokens: 'knob-prompt',
  logic_tokens: 'knob-prompt', stages: 'knob-prompt', compaction: 'knob-compaction', tool_calls_per_minute: 'knob-tools',
  caller_talk_percent: 'knob-talk', agent_talk_percent: 'knob-talk'};

function model(option = state.option, params = state.params) {
  const scheme = schemeById(option);
  return {scheme, result: priceCall(params, scheme)};
}

function notify(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { $('toast').hidden = true; }, 5000);
}

function orbAnchor() {
  const rect = $($('assistant-panel').hidden ? 'launcher-orb' : 'agent-orb').getBoundingClientRect();
  return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
}

// ---- Pricing options: three standard cards and a Custom card for any model and hosting ----------------
function fillCard(card, scheme) {
  const s = scheme.rates;
  const ratio = scheme.mode === 'realtime' ? s.audioInput / s.textCached : null;
  card.querySelector('.scheme-chips').textContent = `${scheme.pipeline} · ${scheme.tier}`;
  card.querySelector('.scheme-sub').textContent = scheme.subtitle;
  card.querySelector('.scheme-rates').textContent = scheme.hosting === 'byom' ? `STT ${rate(s.audioInput)} / TTS ${rate(s.audioOutput)} per 1M · model on your deployment`
    : `${scheme.mode === 'realtime' ? `Audio in ${rate(s.audioInput)} · STT ${rate(s.sttInput)}` : `STT ${rate(s.audioInput)}`} · text ${rate(s.textInput)} / cached ${rate(s.textCached)} per 1M${ratio ? ` · ${int(ratio)}× gap` : ''}`;
  card.querySelector('.scheme-price').textContent = `${cents(priceCall(state.params, scheme).perMinute)}/min${scheme.hosting === 'byom' ? ' + model' : ''}`;
}

function chooseCustom(id) {
  state.custom = id;
  const scheme = schemeById(id);
  userChange({option: id}, `chose ${scheme.name} (${scheme.tier})`);
}

function renderSchemes() {
  const cards = PRESETS.map(id => {
    const scheme = schemeById(id);
    const card = node('button', 'scheme-card');
    card.type = 'button';
    card.setAttribute('role', 'radio');
    card.dataset.scheme = id;
    card.append(node('span', 'scheme-chips'), node('strong', 'scheme-name', scheme.name), node('span', 'scheme-sub'), node('span', 'scheme-rates'), node('span', 'scheme-price'));
    card.onclick = () => userChange({option: id}, `chose ${scheme.name}`);
    return card;
  });
  const custom = node('div', 'scheme-card custom-card');
  custom.id = 'custom-card';
  custom.tabIndex = 0;
  custom.setAttribute('role', 'radio');
  custom.setAttribute('aria-label', 'Custom: any model and hosting');
  const select = node('select', 'custom-model');
  select.id = 'custom-model';
  select.setAttribute('aria-label', 'Model');
  for (const item of MODELS) select.append(Object.assign(node('option', '', `${item.name}${item.realtime ? ' · realtime' : ''}`), {value: item.id}));
  select.onchange = () => {
    const hostings = hostingsFor(select.value);
    const now = schemeById(state.custom).hosting;
    chooseCustom(`${select.value}@${hostings.includes(now) ? now : hostings[0]}`);
  };
  const hosting = node('div', 'segmented custom-hosting');
  hosting.id = 'custom-hosting';
  hosting.setAttribute('role', 'group');
  hosting.setAttribute('aria-label', 'Hosting');
  const head = node('div', 'hosting-head');
  const help = node('button', 'help-dot', '?');
  help.type = 'button';
  help.setAttribute('aria-label', 'What managed and BYOM mean');
  attachTooltip(help, Object.values(HOSTING_HELP).join('\n\n'));
  head.append(node('span', 'hosting-label', 'Hosting'), help);
  const hostingNote = node('p', 'hosting-note');
  hostingNote.id = 'hosting-note';
  custom.append(node('span', 'scheme-chips'), node('strong', 'scheme-name', 'Custom'), select, head, hosting, hostingNote, node('span', 'scheme-sub'),
    node('span', 'scheme-rates'), node('span', 'scheme-price'));
  custom.onclick = event => { if (!event.target.closest('select, button')) chooseCustom(state.custom); };
  custom.onkeydown = event => {
    if (event.target === custom && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); chooseCustom(state.custom); }
  };
  $('scheme-grid').replaceChildren(...cards, custom);
}

function syncSchemes() {
  for (const card of document.querySelectorAll('.scheme-card[data-scheme]')) {
    fillCard(card, schemeById(card.dataset.scheme));
    card.setAttribute('aria-checked', String(card.dataset.scheme === state.option));
  }
  if (!PRESETS.includes(state.option)) state.custom = state.option;
  const custom = schemeById(state.custom);
  const card = $('custom-card');
  card.setAttribute('aria-checked', String(!PRESETS.includes(state.option)));
  $('custom-model').value = custom.model;
  $('custom-hosting').replaceChildren(...hostingsFor(custom.model).map(hosting => {
    const button = node('button', '', HOSTING_LABEL[hosting]);
    button.type = 'button';
    button.dataset.hosting = hosting;
    button.setAttribute('aria-pressed', String(hosting === custom.hosting));
    attachTooltip(button, HOSTING_HELP[hosting]);
    button.onclick = () => chooseCustom(`${custom.model}@${hosting}`);
    return button;
  }));
  $('hosting-note').textContent = hostingNote(custom);
  fillCard(card, custom);
}

// One line under the hosting buttons: who bills the model, and what the price shown includes.
function hostingNote(scheme) {
  if (scheme.hosting === 'managed') return `${scheme.tier}: model, STT and TTS on one bill; the price is the whole cost.`;
  return 'The voice agent bills only STT and TTS (BYO rate, the same for every model). Your model is extra, on your own deployment: pay-as-you-go or PTU, not priced here.';
}

function renderAdvanced() {
  $('advanced-grid').replaceChildren(...ADVANCED.map(([key, text, step, min, max]) => {
    const field = node('label', 'field');
    field.append(node('span', '', text));
    let input;
    if (Array.isArray(step)) {
      input = node('select');
      for (const choice of step) {
        const [name, value] = Array.isArray(choice) ? choice : [choice, choice];
        input.append(Object.assign(node('option', '', name), {value: String(value)}));
      }
    } else {
      input = Object.assign(node('input'), {type: 'number', step, min, max});
    }
    input.id = `in-${key}`;
    input.onchange = () => {
      const choice = Array.isArray(step) ? step.map(item => (Array.isArray(item) ? item : [item, item])).find(([, value]) => String(value) === input.value) : null;
      const value = choice ? choice[1] : Number(input.value);
      userChange({[key]: value}, `set ${text.toLowerCase()} to ${value}`);
    };
    field.append(input);
    return field;
  }));
}

// ---- Talk time: one bar, caller | agent | silence, with two handles ------------------------------------
const talk = {caller: DEFAULTS.callerTalkPercent, speech: DEFAULTS.callerTalkPercent + DEFAULTS.agentTalkPercent};
function drawTalk(caller, speech) {
  const parts = [['talk-caller', caller, 'Caller'], ['talk-agent', speech - caller, 'Agent'], ['talk-silence', 100 - speech, 'Silence']];
  for (const [id, value, name] of parts) {
    $(id).style.width = `${value}%`;
    // The longest label that fits the segment: name and share, the share alone, or nothing.
    const segment = $(id);
    for (const text of [`${name} ${int(value)}%`, `${int(value)}%`, '']) {
      segment.textContent = text;
      if (!text || segment.scrollWidth <= segment.clientWidth + 1) break;
    }
    $(id).title = `${name} ${int(value)}% of the call`;
  }
  for (const [id, value, text] of [['talk-handle-a', caller, `Caller ${int(caller)}%`], ['talk-handle-b', speech, `Agent ${int(speech - caller)}%, silence ${int(100 - speech)}%`]]) {
    $(id).style.left = `${value}%`;
    $(id).setAttribute('aria-valuenow', String(Math.round(value)));
    $(id).setAttribute('aria-valuetext', text);
  }
}
function commitTalk() {
  const caller = Math.round(talk.caller), agent = Math.round(talk.speech - talk.caller);
  if (caller === state.params.callerTalkPercent && agent === state.params.agentTalkPercent) return;
  userChange({callerTalkPercent: caller, agentTalkPercent: agent}, `set talk time to caller ${caller}%, agent ${agent}%`);
}
function moveTalk(handle, value) {
  value = Math.min(100, Math.max(0, value));
  if (handle === 'a') talk.caller = Math.min(value, talk.speech);
  else talk.speech = Math.max(value, talk.caller);
  drawTalk(talk.caller, talk.speech);
}
function wireTalk() {
  for (const [id, handle] of [['talk-handle-a', 'a'], ['talk-handle-b', 'b']]) {
    const element = $(id);
    element.setAttribute('aria-valuemin', '0');
    element.setAttribute('aria-valuemax', '100');
    element.onpointerdown = event => { element.setPointerCapture(event.pointerId); element.dataset.dragging = 'true'; };
    element.onpointermove = event => {
      if (!element.dataset.dragging) return;
      const box = $('talk-bar').getBoundingClientRect();
      moveTalk(handle, (event.clientX - box.left) / box.width * 100);
    };
    element.onpointerup = () => { delete element.dataset.dragging; commitTalk(); };
    element.onkeydown = event => {
      const step = {ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1}[event.key];
      if (!step) return;
      event.preventDefault();
      moveTalk(handle, (handle === 'a' ? talk.caller : talk.speech) + step);
      commitTalk();
    };
  }
}

// ---- Prompt: system prompt + business logic, one block or split by stage --------------------------------
function drawPrompt(p, r) {
  const total = Math.max(1, p.systemPromptTokens + p.logicTokens);
  const split = p.promptDesign === 'stage';
  const mainNodes = split ? r.plan.filter(node => node.role === 'main') : [];
  const branches = split ? r.plan.filter(node => node.role === 'branch').length : 0;
  const mainLogic = split ? mainNodes.reduce((total, node) => total + node.logic, 0) : p.logicTokens;
  const parts = [['prompt-system', p.systemPromptTokens, `System ${int(p.systemPromptTokens)}`],
    ['prompt-logic', mainLogic, split ? `Main ${int(mainLogic)}` : `Logic ${int(p.logicTokens)}`],
    ['prompt-rest', split ? p.logicTokens - mainLogic : 0, split ? `other nodes ${int(p.logicTokens - mainLogic)}` : '']];
  for (const [id, value, text] of parts) {
    $(id).style.width = `${100 * value / total}%`;
    $(id).textContent = 100 * value / total >= 14 ? text : '';
    $(id).title = text;
  }
  $('prompt-hint').textContent = split
    ? `${int(r.plan.length)} nodes: routing nodes of about 2 caller turns first, ${mainNodes.length > 1 ? `${mainNodes.length} main nodes` : 'one main node'} in the middle with ${int(mainLogic)} of the ${int(p.logicTokens)} logic tokens, then one end node for the last turns${branches ? `; ${int(branches)} if-else branch ${branches > 1 ? 'nodes hold' : 'node holds'} logic but ${branches > 1 ? 'are' : 'is'} not taken` : ''}. A request carries ${int(p.systemPromptTokens)} + its node's logic, ${int(r.instructions)} on average.`
    : `Each request carries ${int(p.systemPromptTokens)} + ${int(p.logicTokens)} = ${int(r.instructions)} tokens.`;
}

function wireSetup() {
  wireTalk();
  for (const [id, key, text] of [['system-tokens', 'systemPromptTokens', 'the system prompt'], ['logic-tokens', 'logicTokens', 'the business logic'], ['stages', 'stages', 'the number of stages']])
    $(id).onchange = () => userChange({[key]: Number($(id).value)}, `set ${text} to ${$(id).value}`);
  $('tools').oninput = () => { $('tools-out').textContent = `${num(Number($('tools').value))} / min`; };
  $('tools').onchange = () => userChange({toolCallsPerMinute: Number($('tools').value)}, `set tool calls to ${$('tools').value} a minute`);
}

// Show the current inputs and prices in every control.
function syncControls() {
  const p = state.params;
  const {scheme, result} = model();
  state.result = result;
  syncSchemes();
  $('minutes').value = p.minutes;
  $('minutes-out').textContent = `${num(p.minutes)} min`;
  for (const button of document.querySelectorAll('[data-minutes]')) button.setAttribute('aria-pressed', String(Number(button.dataset.minutes) === p.minutes));
  const split = p.promptDesign === 'stage';
  $('cache-measured').textContent = result.modelOnDeployment ? 'not priced' : pct(result.cacheShare);
  $('cache-hint').textContent = result.modelOnDeployment
    ? 'BYOM: the model and its cache are billed on your own deployment, not here.'
    : `Worked out response by response, not set: ${pct(result.resentHitShare)} of what is sent again hits the cache; a handoff or a compaction restarts it.`;
  for (const button of document.querySelectorAll('[data-prompt]')) button.setAttribute('aria-pressed', String(button.dataset.prompt === p.promptDesign));
  $('system-tokens').value = p.systemPromptTokens;
  $('logic-tokens').value = p.logicTokens;
  $('stages').value = p.stages;
  $('stages').disabled = p.promptDesign !== 'stage';
  drawPrompt(p, result);
  Object.assign(talk, {caller: p.callerTalkPercent, speech: p.callerTalkPercent + p.agentTalkPercent});
  drawTalk(talk.caller, talk.speech);
  $('tools').value = p.toolCallsPerMinute;
  $('tools-out').textContent = `${num(p.toolCallsPerMinute)} / min`;
  $('tools-hint').textContent = `${num(p.toolCallsPerMinute)} of ${num(result.responsesPerMinute)} responses a minute are tool calls; each writes ${int(p.toolCallTokens)} tokens of arguments and gets ${int(p.toolResultTokens)} back.`;
  $('summarise').checked = p.summarise;
  $('summary-text').textContent = !p.summarise ? 'off · keeps all history' : split ? 'at each handoff' : `every ${int(p.compactEveryTurns)} caller turns, keeping the last 2`;
  for (const [key] of ADVANCED) $(`in-${key}`).value = p[key];
  // BYOM: the voice-agent cost only, with the model named as the extra on the customer's own deployment.
  const plus = result.extra ? ` + ${result.extra}` : '';
  $('preview-price').textContent = `${cents(result.perMinute)}/min${result.extra ? ' + model' : ''}`;
  const plusModel = result.extra ? ' + model' : '';
  $('preview-note').textContent = `${format.usd(result.perCall)}${plusModel} per ${num(p.minutes)}-minute call · ${format.usd(result.monthly, 0)}${plusModel} for ${int(p.monthlyCalls)} calls a month · ${scheme.name} (${scheme.tier})`;
  $('result-scheme').textContent = `${scheme.name} (${scheme.tier}) · ${num(p.minutes)} min · `
    + (result.extra ? `voice-agent cost${plus}` : `${pct(result.cacheShare)} of model input cached`);
}

// The settings the savings are worked out for, in one line at the top of the panel.
function settingsLine() {
  const p = state.params, scheme = schemeById(state.option);
  return [`${scheme.name} (${scheme.tier})`, `${num(p.minutes)} min`,
    p.promptDesign === 'stage' ? `prompt split into ${int(p.stages)} stages` : 'one mixed prompt',
    `${int(p.systemPromptTokens + p.logicTokens)} prompt tokens`, `compaction ${p.summarise ? 'on' : 'off'}`,
    `${num(p.toolCallsPerMinute)} tool calls/min`].join(' · ');
}

// Every change goes through here. State changes at once (the Agent's next call must see it); the
// visible update waits for the guide's speech when the Agent made the change.
function apply(option, params, changed, source) {
  model(option, params);
  state.option = option;
  state.params = params;
  state.walkthrough = null;
  syncUrl();
  if (!PRESETS.includes(option)) state.custom = option;
  const show = () => {
    syncControls();
    refreshTree();
    refreshSavings();
    showResultNow(false);
    if (source === 'agent') {
      for (const key of changed) {
        const target = ['model', 'hosting', 'option'].includes(key)
          ? (PRESETS.includes(option) ? document.querySelector(`.scheme-card[data-scheme="${option}"]`) : $('custom-card'))
          : $(KNOB[key] ?? 'advanced');
        if (target) { fx.beam(orbAnchor(), target); fx.pulseAttribute(target, 'data-flash', 1200); }
      }
    }
  };
  if (source === 'agent' && guide) guide.whenSpoken(show); else show();
}

// The address bar always holds the link to the current settings, so it can be shared as it is.
function syncUrl() {
  history.replaceState(history.state, '', `${location.pathname}?${settingsQuery(state.option, state.params)}${location.hash}`);
}

// A link opens the settings it carries; what it gets wrong is ignored and named.
function loadSettingsFromUrl() {
  const {option, params, ignored} = settingsFromQuery(location.search, state.option);
  state.option = option;
  state.params = params;
  if (!PRESETS.includes(option)) state.custom = option;
  talk.caller = params.callerTalkPercent;
  talk.speech = params.callerTalkPercent + params.agentTalkPercent;
  if (ignored.length) {
    $('input-error').textContent = `This link had settings the page could not use, so they are at their defaults: ${ignored.join(', ')}.`;
    $('input-error').hidden = false;
  }
}

function flashLabel(button, text) {
  const label = button.dataset.label ?? (button.dataset.label = button.textContent);
  button.textContent = text;
  clearTimeout(button.labelTimer);
  button.labelTimer = setTimeout(() => { button.textContent = label; }, 1800);
}

async function copySettingsLink() {
  const url = settingsUrl(location, state.option, state.params);
  try {
    await navigator.clipboard.writeText(url);
    flashLabel($('copy-link'), 'Link copied ✓');
  } catch {
    window.prompt('Copy this link to open the page with these settings:', url);
  }
}

function exportExcel() {
  const {scheme, result} = model();
  const bytes = costWorkbook({tree: view.tree, result, scheme, option: state.option, params: state.params,
    url: settingsUrl(location, state.option, state.params)});
  const link = node('a');
  link.href = URL.createObjectURL(new Blob([bytes], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  link.download = exportFileName(state.option, state.params);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  flashLabel($('export-excel'), 'Exported ✓');
}

function refreshSavings() {
  const tips = renderSavings($('savings-list'), state.params, schemeById(state.option), tip => {
    if (tip.option) userChange({option: tip.option}, `tried "${tip.title}"`);
    else userChange(tip.active ? tip.without : tip.with, `${tip.active ? 'turned off' : 'tried'} "${tip.title}"`);
  });
  $('savings-context').textContent = `For: ${settingsLine()}`;
  const open = tips.filter(tip => !tip.active).length;
  $('savings-count').textContent = open ? String(open) : '✓';
  $('savings-toggle').setAttribute('aria-label', `Ways to pay less: ${open ? `${open} for these settings` : 'none left for these settings'}`);
}

// The ways to pay less open from the right edge, over the page, and close with ×, Escape or the tab.
function placeSavings() {
  $('savings').style.top = `${Math.ceil(document.querySelector('.site-header').getBoundingClientRect().bottom)}px`;
}
function openSavings(show = $('savings').hidden) {
  if (show) placeSavings();
  $('savings').hidden = !show;
  $('savings-toggle').setAttribute('aria-expanded', String(show));
  $('nav-savings').setAttribute('aria-expanded', String(show));
  if (show) $('savings-close').focus({preventScroll: true});
}

function userChange(patch, description) {
  const option = patch.option ?? state.option;
  const params = {...state.params, ...patch};
  delete params.option;
  try {
    apply(option, params, Object.keys(patch), 'user');
    $('input-error').hidden = true;
    guide?.note(`The visitor ${description}; the price is now ${cents(state.result.perMinute).replace(' ¢', ' cents')} a minute.`);
  } catch (error) {
    $('input-error').textContent = error.message;
    $('input-error').hidden = false;
    syncControls();
  }
}

// ---- Cost tree: price per minute, broken down -------------------------------------------------------
// Clicking a node opens it and shows below the tree how it is worked out, with its picture.
const view = {tree: null, expanded: new Set(['price']), selected: 'price', concept: null};
let narration = null;
const narrationLog = [];
const CAPTIONS = {
  totals: 'The cost lines, each in cents per minute, stacked into the price per minute.',
  call_shape: 'One call split into caller, agent and silence; only speech is billed as audio.',
  responses: 'Each tick is one model response, and each response sends the instructions and the conversation again.',
  new_audio: 'Speech becomes audio tokens: talk seconds per minute times tokens per second.',
  instructions: 'One block of instructions goes with every response.',
  text_history: 'Row k is response k; its bar is the earlier turns it reads again. Worked out for the whole call, then divided by its length.',
  audio_reread: 'Row k is response k; its bar is the earlier caller audio it hears again. Worked out for the whole call, then divided by its length.',
  cache_split: 'What is sent again splits into a part at the full rate and a hatched part at the cached rate.',
  line_costs: 'Each cost line in cents per minute, largest first.',
};

// The tree shows only the breakdown: a cost opens into the costs it adds up from. A product (tokens × rate) is a
// leaf with its numbers on the row; its factors are worked out as equations in the detail area, not as tree rows.
const treeParts = item => (item.op === 'sum' && item.kind === 'cost' ? item.children : []);
// The tree row a node shows on: itself, or the product it is a factor of.
function treeNodeId(id) {
  const parts = id.split('.');
  let at = parts[0];
  for (let i = 2; i <= parts.length; i++) {
    const item = findNode(view.tree, at);
    if (!item || !treeParts(item).length) return at;
    at = parts.slice(0, i).join('.');
  }
  return at;
}

function refreshTree() {
  const {scheme, result} = model();
  view.tree = buildCostTree(result, scheme);
  if (!findNode(view.tree, view.selected)) view.selected = 'price';
  view.selected = treeNodeId(view.selected);
  for (const id of [...view.expanded]) if (!findNode(view.tree, id)) view.expanded.delete(id);
  $('price-now').textContent = view.tree.display;
  $('price-note').textContent = `${scheme.name} · ${num(state.params.minutes)}-minute call · `
    + (result.extra ? `voice-agent cost + ${result.extra}` : `${pct(result.cacheShare)} of model input cached`);
  renderTree();
  showDetail();
}

function renderTree() {
  const list = node('ul');
  list.setAttribute('role', 'tree');
  list.setAttribute('aria-label', 'Price per minute, broken down');
  list.append(treeItem(view.tree, 1));
  // Column heads: the tokens and the rate a cost is the product of, then the cost.
  const head = node('div', 'tree-head');
  head.setAttribute('aria-hidden', 'true');
  head.append(node('span'), node('span'), node('span', '', 'Cost line'), node('span', 'tree-num', 'Tokens / min'), node('span', 'tree-num', 'Rate / 1M'),
    node('span', 'tree-num', 'Cost / min'), node('span'));
  $('cost-tree').replaceChildren(head, list);
}

function treeItem(item, level) {
  const li = node('li');
  li.setAttribute('role', 'treeitem');
  li.setAttribute('aria-level', String(level));
  const kids = treeParts(item);
  const open = view.expanded.has(item.id) && kids.length > 0;
  if (kids.length) li.setAttribute('aria-expanded', String(open));
  const row = node('button', 'tree-row');
  row.type = 'button';
  row.dataset.node = item.id;
  row.dataset.kind = item.kind;
  if (item.symbol) row.dataset.symbol = item.symbol;
  row.setAttribute('aria-current', String(item.id === view.selected && !view.concept));
  const toggle = node('span', 'tree-toggle', kids.length ? '▶' : '');
  toggle.dataset.open = String(open);
  const bar = node('span', `tree-bar ${item.series ?? ''}`);
  if (item.kind === 'cost' && view.tree.value) {
    const fill = node('i');
    fill.style.width = `${Math.max(.5, 100 * item.value / view.tree.value)}%`;
    bar.append(fill);
    bar.title = `${pct(item.value / view.tree.value, 1)} of the price per minute`;
  }
  row.append(toggle, node('span', `tree-chip ${item.series ?? ''}`), node('span', 'tree-label', item.label),
    node('span', 'tree-num', item.tokensPerMinute != null ? num(item.tokensPerMinute, item.tokensPerMinute < 10 ? 2 : 0) : ''),
    node('span', 'tree-num', item.usdPerM != null ? rate(item.usdPerM) : ''), node('span', 'tree-value', item.display), bar);
  row.onclick = () => {
    selectNode(item.id, {collapse: open && view.selected === item.id && !view.concept});
    guide?.note(`The visitor opened "${item.label}" (${item.display}) in the cost tree.`);
  };
  li.append(row);
  if (open) {
    const group = node('ul');
    group.setAttribute('role', 'group');
    for (const child of kids) group.append(treeItem(child, level + 1));
    li.append(group);
  }
  return li;
}

// Opens the node, all its ancestors and its parts, and shows it in the detail area.
function selectNode(id, {collapse = false, flash = false} = {}) {
  if (!findNode(view.tree, id)) return null;
  id = treeNodeId(id);
  const item = findNode(view.tree, id);
  const parts = id.split('.');
  for (let i = 1; i <= parts.length; i++) view.expanded.add(parts.slice(0, i).join('.'));
  if (collapse) view.expanded.delete(id);
  view.selected = id;
  view.concept = null;
  renderTree();
  showDetail();
  const row = document.querySelector(`.tree-row[data-node="${CSS.escape(id)}"]`);
  if (flash && row) {
    row.scrollIntoView({behavior: motionAllowed() ? 'smooth' : 'auto', block: 'nearest'});
    fx.pulseAttribute(row, 'data-flash', 1200);
  }
  return item;
}

function showConcept(name) {
  view.concept = name;
  renderTree();
  showDetail();
}

// A product's factors as equations, each indented under the factor it feeds: "Uncached tokens = 2,415 ÷ 15 min".
function factorLines(item) {
  if (!item.children.length) return [];
  const lines = [node('li', 'detail-head', 'Where')];
  const walk = (factor, depth) => {
    const li = node('li', 'factor');
    li.style.setProperty('--depth', depth);
    li.append(node('span', 'factor-label', factor.label), node('span', 'factor-eq', factor.numbers ? `= ${factor.numbers}` : ''), node('b', '', factor.display));
    lines.push(li);
    factor.children.forEach(child => walk(child, depth + 1));
  };
  item.children.forEach(child => walk(child, 0));
  return lines;
}

function showDetail() {
  const {scheme, result} = model();
  for (const chip of document.querySelectorAll('.concept-chip')) chip.setAttribute('aria-pressed', String(chip.dataset.concept === view.concept));
  if (view.concept) {
    const text = CONCEPT_TEXT[view.concept];
    $('detail-path').textContent = 'HOW IT WORKS';
    $('formula-title').textContent = text.title;
    for (const id of ['detail-value', 'formula-symbolic', 'formula-numbers']) $(id).textContent = '';
    $('detail-explain').textContent = text.text;
    $('detail-children').replaceChildren();
    $('stage-caption').textContent = 'Solid: new, billed at the full rate. Hatched: sent before, billed at the cached rate when it hits.';
  } else {
    const item = findNode(view.tree, view.selected);
    const parts = item.id.split('.');
    $('detail-path').textContent = parts.slice(0, -1).map((_, i) => findNode(view.tree, parts.slice(0, i + 1).join('.')).label).join(' › ');
    $('formula-title').textContent = item.label;
    $('detail-value').textContent = item.display;
    $('formula-symbolic').textContent = item.formula ?? '';
    $('formula-numbers').textContent = item.numbers ? `= ${item.numbers}` : '';
    $('detail-explain').textContent = item.explain;
    const kids = treeParts(item);
    $('detail-children').replaceChildren(...(kids.length ? kids.map(child => {
      const li = node('li');
      const button = node('button');
      button.type = 'button';
      button.append(node('span', '', child.label), node('b', '', child.display));
      button.onclick = () => selectNode(child.id, {flash: true});
      li.append(button);
      return li;
    }) : factorLines(item)));
    $('stage-caption').textContent = CONCEPT_TEXT[item.visual]?.text ?? CAPTIONS[item.visual] ?? '';
  }
  fx.pulseAttribute(document.querySelector('.formula-card'), 'data-flash', 900);
  stage.show(view.concept ?? findNode(view.tree, view.selected).visual, result, scheme);
}

// The guide says the whole breakdown in one reply. Each part opens when its number reaches the transcript,
// held until the speech before it has played; a missed number does not stop later ones. The bill opens
// when that reply ends.
function narrate(delta) {
  if (!narration) return;
  narration.text += delta;
  for (;;) {
    let found = -1, at = -1;
    for (let j = narration.next; j < narration.script.length && found < 0; j++) {
      at = narration.text.indexOf(narration.script[j].marker, narration.cursor);
      if (at >= 0) found = j;
    }
    if (found < 0) return;
    const item = narration.script[found];
    narration.cursor = at + item.marker.length;
    narration.next = found + 1;
    guide.whenSpoken(() => {
      if (item.concept) showConcept(item.concept); else selectNode(item.node_id, {flash: true});
      narrationLog.push(item.concept ? `concept:${item.concept}` : item.node_id);
    });
  }
}

function finishNarration() {
  if (!narration?.text) return; // the reply that only called start_walkthrough
  narration = null;
  guide.whenSpoken(() => showResultNow());
}

// ---- Result: always the current inputs ------------------------------------------------------------
function showResultNow(scroll = true, compareIds) {
  const {scheme, result} = model();
  renderTiles($('tiles'), result);
  renderBill($('bill'), result, scheme);
  renderCompare($('compare'), state.params, state.option, compareIds ?? comparisonIds(state.params, state.option));

  renderCurve($('curve'), state.params, scheme);
  $('assumptions').replaceChildren(...assumptions(result).map(text => node('li', '', text)));
  if (scroll) $('result').scrollIntoView({behavior: motionAllowed() ? 'smooth' : 'auto', block: 'start'});
}

// ---- What the Agent's functions drive ------------------------------------------------------------
const later = show => (guide ? guide.whenSpoken(show) : show());
const page = {
  state: () => ({option: state.option, params: state.params, walkthrough: state.walkthrough}),
  apply: (option, params, changed) => apply(option, params, changed, 'agent'),
  walkthrough: script => {
    state.walkthrough = {script, shown: []};
    narration = {script, next: 0, cursor: 0, text: ''};
    narrationLog.length = 0;
    later(() => {
      view.expanded = new Set(['price']);
      selectNode('price');
      $('calc').scrollIntoView({behavior: motionAllowed() ? 'smooth' : 'auto', block: 'start'});
    });
  },
  node: id => {
    state.walkthrough?.shown.push(id);
    later(() => selectNode(id, {flash: true}));
  },
  concept: name => later(() => {
    showConcept(name);
    $('detail').scrollIntoView({behavior: motionAllowed() ? 'smooth' : 'auto', block: 'nearest'});
  }),
  result: () => later(() => showResultNow()),
  savings: () => later(() => {
    openSavings(true);
    fx.pulseAttribute($('savings'), 'data-flash', 1200);
  }),
  compare: ids => {
    later(() => {
      showResultNow(false, ids);
      $('compare').closest('.chart-card').scrollIntoView({behavior: motionAllowed() ? 'smooth' : 'auto', block: 'center'});
      fx.pulseAttribute($('compare').closest('.chart-card'), 'data-flash', 1200);
    });
    return rankingSummary(rankOptions(state.params, ids));
  },
};
const tools = new PageTools(page);
const ACTION_TARGET = {start_walkthrough: 'price-now', show_cost_node: 'cost-tree', show_concept: 'stage', show_result: 'tiles', compare_options: 'compare', show_savings: 'savings-toggle'};

function wireControls() {
  for (const button of document.querySelectorAll('[data-minutes]'))
    button.onclick = () => userChange({minutes: Number(button.dataset.minutes)}, `set the call length to ${button.dataset.minutes} minutes`);
  $('minutes').oninput = () => { $('minutes-out').textContent = `${$('minutes').value} min`; };
  $('minutes').onchange = () => userChange({minutes: Number($('minutes').value)}, `set the call length to ${$('minutes').value} minutes`);
  for (const button of document.querySelectorAll('[data-prompt]'))
    button.onclick = () => userChange({promptDesign: button.dataset.prompt}, `chose the ${button.dataset.prompt} prompt design`);
  $('summarise').onchange = () => userChange({summarise: $('summarise').checked}, `turned compaction ${$('summarise').checked ? 'on' : 'off'}`);
  $('skip').onclick = () => showResultNow();
  $('savings-toggle').onclick = () => openSavings();
  $('nav-savings').onclick = () => openSavings();
  $('savings-close').onclick = () => { openSavings(false); $('savings-toggle').focus({preventScroll: true}); };
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('savings').hidden) openSavings(false); });
  addEventListener('resize', () => { if (!$('savings').hidden) placeSavings(); });
  $('copy-link').onclick = copySettingsLink;
  $('export-excel').onclick = exportExcel;
  $('expand-all').onclick = () => { for (const item of allNodes(view.tree)) if (treeParts(item).length) view.expanded.add(item.id); renderTree(); };
  $('collapse-all').onclick = () => { view.expanded = new Set(['price']); renderTree(); };
  for (const chip of document.querySelectorAll('.concept-chip')) chip.onclick = () => {
    showConcept(chip.dataset.concept);
    guide?.note(`The visitor opened the explanation "${CONCEPT_TEXT[chip.dataset.concept].title}".`);
  };
}

function wireGuide(config) {
  guide = new VoiceGuide({config, onTranscript: narrate, onResponseDone: finishNarration, onInterrupted: () => { narration = null; },
    execute: (name, args) => tools.execute(name, args), onAction: name => {
    const target = $(ACTION_TARGET[name]);
    if (target) guide.whenSpoken(() => fx.beam(orbAnchor(), target));
  }});
  new WireOrb($('agent-orb'), {read: () => guide.visual(), radius: .21});
  new WireOrb($('launcher-orb'), {read: () => guide.visual(), detail: .55, hud: false});
  $('connect').disabled = !config.voice_available;
  if (!config.voice_available) $('voice-status').textContent = 'Voice is off: the server runs in preview mode. Start the voice server to have the guide explain the cost.';
  const open = show => {
    $('assistant-panel').hidden = !show;
    $('guide-launcher').setAttribute('aria-expanded', String(show));
  };
  $('guide-launcher').onclick = () => {
    const show = $('assistant-panel').hidden;
    open(show);
    if (show && config.voice_available && !guide.socket) void guide.connect();
  };
  $('connect').onclick = () => void guide.connect();
  $('close-guide').onclick = () => { void guide.disconnect(); open(false); };
  $('type-toggle').onclick = () => {
    $('message-form').hidden = !$('message-form').hidden;
    $('type-toggle').setAttribute('aria-expanded', String(!$('message-form').hidden));
  };
  $('message-form').onsubmit = event => {
    event.preventDefault();
    const text = $('message').value.trim();
    if (!text) return;
    try { guide.sendText(text); $('message').value = ''; } catch (error) { guide.showError(error.message); }
  };
  const frame = () => { requestAnimationFrame(frame); if (!$('assistant-panel').hidden) guide.refreshState(); };
  requestAnimationFrame(frame);
}

async function initialize() {
  $('rates-as-of').textContent = `RATES AS OF ${RATES_AS_OF}`;
  loadSettingsFromUrl();
  renderSchemes();
  renderAdvanced();
  wireSetup();
  syncControls();
  wireControls();
  refreshTree();
  refreshSavings();
  showResultNow(false);
  let config = {voice_available: false, transport: 'preview'};
  try {
    const response = await fetch('api/config', {cache: 'no-store'});
    if (response.ok) config = await response.json();
  } catch { /* preview */ }
  wireGuide(config);
  // Rehearse without Azure: the same path as a real Agent call, e.g.
  // costDemo.simulateAgentCall('set_parameters', {model: 'gpt-realtime-2.1', minutes: 30})
  window.costDemo = {
    simulateAgentCall: (name, args = {}) => guide.executeCall({call_id: `sim-${crypto.randomUUID()}`, name, arguments: JSON.stringify(args)}),
    state: () => structuredClone({option: state.option, params: state.params, shown: state.walkthrough?.shown ?? null}),
    view: () => ({selected: view.selected, concept: view.concept, expanded: [...view.expanded], price: $('price-now').textContent}),
    narrated: () => ({expected: (state.walkthrough?.script ?? []).map(item => item.concept ? `concept:${item.concept}` : item.node_id),
      shown: [...narrationLog]}),
    simulateNarration: text => { narrate(text); finishNarration(); return window.costDemo.narrated(); },
    calls: () => [...guide.completed.values()].map(({name, raw, result}) => ({name, args: JSON.parse(raw), ok: result.ok, result})),
  };
}

initialize().catch(error => notify(error.message));
