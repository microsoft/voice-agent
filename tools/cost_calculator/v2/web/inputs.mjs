// The page's inputs, their checks and the quantities every part of the page shares: responses per call, talk
// time, the instructions each request carries and the text written per response. The price itself comes from
// the response-by-response walk (response-model.mjs, calibrated on the team's live calls), put together in
// pricing.mjs.
import {nodePlan, pyRound} from './response-model.mjs';

export const DEFAULTS = Object.freeze({
  minutes: 15, monthlyCalls: 10000,
  callerTalkPercent: 55, agentTalkPercent: 35, repliesPerMinute: 2.5, toolCallsPerMinute: 0.5,
  promptDesign: 'single', systemPromptTokens: 2000, logicTokens: 4000, stages: 5,
  replyTokens: 130, toolCallTokens: 130, toolResultTokens: 120, messageOverheadTokens: 10, reasoningTokens: 0,
  summarise: false, compactEveryTurns: 10, branchNodes: 1, transcriptTokensPerSecond: 3, cascadeCacheFallback: true,
  inputAudioRate: 10, outputAudioRate: 20,
  currency: 'USD', fxRate: 86, discountPercent: 0,
});

export const CHOICES = Object.freeze({
  promptDesign: ['single', 'stage'], currency: ['USD', 'INR'],
});
const PERCENT_KEYS = ['callerTalkPercent', 'agentTalkPercent', 'discountPercent'];
const POSITIVE_KEYS = ['minutes', 'fxRate', 'stages', 'compactEveryTurns'];
const INTEGER_KEYS = ['monthlyCalls', 'stages', 'compactEveryTurns', 'branchNodes'];

export function validateParams(p) {
  const unknown = Object.keys(p).filter(key => !(key in DEFAULTS));
  if (unknown.length) throw new Error(`Unknown inputs: ${unknown.join(', ')}.`);
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (typeof value === 'number' && (typeof p[key] !== 'number' || !Number.isFinite(p[key]) || p[key] < 0))
      throw new Error(`${key} must be a finite number of zero or more.`);
  }
  for (const [key, allowed] of Object.entries(CHOICES)) {
    if (!allowed.includes(p[key])) throw new Error(`${key} must be one of: ${allowed.join(', ')}.`);
  }
  for (const key of ['summarise', 'cascadeCacheFallback']) if (typeof p[key] !== 'boolean') throw new Error(`${key} must be true or false.`);
  for (const key of POSITIVE_KEYS) if (p[key] === 0) throw new Error(`${key} must be greater than zero.`);
  for (const key of INTEGER_KEYS) if (!Number.isInteger(p[key])) throw new Error(`${key} must be a whole number.`);
  for (const key of PERCENT_KEYS) if (p[key] > 100) throw new Error(`${key} must be between 0 and 100.`);
  if (p.callerTalkPercent + p.agentTalkPercent > 100) throw new Error('Caller and agent talk time cannot exceed 100% of the call.');
  if (p.repliesPerMinute + p.toolCallsPerMinute === 0) throw new Error('Replies and tool calls per minute cannot both be zero.');
}

// The shared quantities of one call. Usage is a share of the call or a rate per minute, so the call length scales it.
export function callDrivers(params, scheme) {
  const p = {...DEFAULTS, ...params};
  validateParams(p);
  const T = p.minutes, seconds = T * 60;
  const callerSeconds = seconds * p.callerTalkPercent / 100;
  const agentSeconds = seconds * p.agentTalkPercent / 100;
  // A response is a spoken reply or a tool (MCP) call: after a call the model answers again with the result.
  const responsesPerMinute = p.repliesPerMinute + p.toolCallsPerMinute;
  const K = Math.max(1, Math.round(responsesPerMinute * T));
  // The system prompt goes with every response. One mixed prompt adds all the business logic; a prompt split into
  // nodes adds the logic of the node handling the response (nodePlan: routing nodes first, the main node, one end node; the main node in
  // the middle, logic in proportion to the responses each node handles), so per response it is an average.
  const respPerTurn = p.repliesPerMinute > 0 ? responsesPerMinute / p.repliesPerMinute : 1;
  const plan = p.promptDesign === 'stage' ? nodePlan(Math.max(1, pyRound(responsesPerMinute * T)), p.stages, respPerTurn, p.logicTokens, p.branchNodes) : null;
  const logicPerResponse = plan
    ? plan.reduce((total, node) => total + node.logic * node.length, 0) / plan.reduce((total, node) => total + node.length, 0) : p.logicTokens;
  const instructions = p.systemPromptTokens + logicPerResponse;
  // Text the conversation grows by per response, averaged over replies and tool calls: the reply, a tool call's
  // arguments and its result.
  const sharedHistory = (p.repliesPerMinute * p.replyTokens + p.toolCallsPerMinute * (p.toolCallTokens + p.toolResultTokens)) / responsesPerMinute;
  // Written per response: reply text or tool-call arguments (both text output), plus reasoning.
  const outputPerResponse = (p.repliesPerMinute * p.replyTokens + p.toolCallsPerMinute * p.toolCallTokens) / responsesPerMinute + p.reasoningTokens;
  return {
    params: p, scheme: scheme.id, mode: scheme.mode,
    seconds, callerSeconds, agentSeconds, silentSeconds: seconds - callerSeconds - agentSeconds,
    responses: K, responsesPerMinute, replyShare: p.repliesPerMinute / responsesPerMinute, toolShare: p.toolCallsPerMinute / responsesPerMinute,
    plan, logicPerResponse, instructions, sharedHistory, outputPerResponse,
    localFactor: (p.currency === 'USD' ? 1 : p.fxRate) * (1 - p.discountPercent / 100),
  };
}
