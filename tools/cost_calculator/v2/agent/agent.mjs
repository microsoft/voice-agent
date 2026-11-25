// Voice Agent definition and the az-login credential for the cost walkthrough page. Ported from
// samples/ignite_planner/agent/agent.mjs. The prompt is prompt.txt and the tools are tools.json;
// every function is executed by the page.
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {promisify} from 'node:util';
import {RATES_AS_OF} from '../web/rate-card.mjs';

const HERE = new URL('./', import.meta.url);
// Control-plane calls come from Node and can send the preview header. A browser WebSocket
// cannot, so its handshake uses the preview api-version that enables Voice Agents instead.
export const CONTROL_API_VERSION = 'v1';
export const BROWSER_API_VERSION = '2025-11-15-preview';
const FEATURES = {'Foundry-Features': 'VoiceAgents=V1Preview'};

export function validateEndpoint(endpoint) {
  const url = new URL(endpoint);
  const parts = url.pathname.replace(/\/$/, '').split('/');
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.services.ai.azure.com') || url.username || url.password
      || url.search || url.hash || url.port || parts.length !== 4 || parts[1] !== 'api' || parts[2] !== 'projects' || !parts[3])
    throw new Error('Use the public-cloud HTTPS Foundry project endpoint.');
  return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
}

export function agentInstructions() {
  return readFileSync(new URL('prompt.txt', HERE), 'utf8').trim() +
    `\n\nRATES\nList prices in USD as of ${RATES_AS_OF}. The page holds the rate card; ask it, never quote rates from memory.`;
}

// The cost advisor on the public no-auth MCP: the recommendation and the ways to pay less, with each tip checked
// against measured calls. The page prices and compares on its own, so only these two tools are offered.
export const COST_MCP_URL = 'https://voice-agent-noauth-mcp.lemonsky-36682081.westus2.azurecontainerapps.io/mcp/cost-advisor';
export const COST_TOOLS = Object.freeze(['cost_recommend_setup', 'cost_savings_tips']);

export function agentDefinition({model = 'gpt-realtime', voice = 'en-US-AvaNeural', mcpUrl = COST_MCP_URL} = {}) {
  return {
    kind: 'voice', model_type: 'managed', model,
    instructions: agentInstructions(),
    tools: [...JSON.parse(readFileSync(new URL('tools.json', HERE), 'utf8')),
      ...(mcpUrl ? [{type: 'mcp', server_label: 'cost', server_url: mcpUrl, allowed_tools: [...COST_TOOLS], require_approval: 'never'}] : [])],
    parallel_tool_calls: false, store: false,
    audio: {
      input: {
        format: {type: 'audio/pcm', rate: 24000},
        turn_detection: {
          type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 700,
          create_response: false, interrupt_response: false,
        },
        transcription: {model: 'whisper-1'},
      },
      output: {format: {type: 'audio/pcm', rate: 24000}, voice, voice_type: 'azure-standard'},
    },
    output_modalities: ['text', 'audio'],
  };
}

// The name is derived from the definition, so a restart reuses the same Agent and a changed
// prompt, tool list or voice gets a new one instead of silently replacing an existing Agent.
export function agentName(definition) {
  return `cost-walkthrough-js-${createHash('sha256').update(JSON.stringify(definition)).digest('hex').slice(0, 10)}`;
}

export function websocketUrl(endpoint, name) {
  return `${endpoint.replace(/^https:/, 'wss:')}/agents/${encodeURIComponent(name)}/endpoint/protocols/voice` +
    `?api-version=${BROWSER_API_VERSION}`;
}

export async function ensureAgent({endpoint, definition, name, token, fetchImpl = fetch}) {
  const call = (method, path, body) => fetchImpl(`${endpoint}/agents/${encodeURIComponent(name)}${path}?api-version=${CONTROL_API_VERSION}`, {
    method, body: body && JSON.stringify(body),
    headers: {Authorization: `Bearer ${token}`, ...FEATURES, ...(body ? {'Content-Type': 'application/json'} : {})},
  });
  const existing = await call('GET', '');
  let created = false;
  if (existing.status === 404) {
    const response = await call('POST', '/versions', {definition});
    if (!response.ok) throw new Error(`Creating ${name} failed: HTTP ${response.status} ${await response.text()}`);
    created = true;
  } else if (!existing.ok) {
    throw new Error(`Reading ${name} failed: HTTP ${existing.status} ${await existing.text()}`);
  }
  const enabled = await call('POST', ':enable');
  if (!enabled.ok) throw new Error(`Enabling ${name} failed: HTTP ${enabled.status} ${await enabled.text()}`);
  return {name, created};
}

// The developer's own `az login`, cached in memory and refreshed five minutes before expiry; it is
// handed only to same-origin loopback pages.
export class AzureCliToken {
  constructor(run = promisify(execFile)) {
    this.run = run;
    this.cached = null;
    this.pending = null;
  }

  async get() {
    if (this.cached && this.cached.expires_on * 1000 - Date.now() > 5 * 60 * 1000) return this.cached;
    this.pending ??= this.run('az', ['account', 'get-access-token', '--resource', 'https://ai.azure.com',
      '--query', '{token:accessToken,expires_on:expires_on}', '-o', 'json'], {shell: process.platform === 'win32'})
      .then(({stdout}) => {
        const value = JSON.parse(stdout);
        if (typeof value.token !== 'string' || !value.token || !Number.isFinite(value.expires_on))
          throw new Error('az returned no access token. Run az login.');
        this.cached = value;
        return value;
      })
      .finally(() => { this.pending = null; });
    return this.pending;
  }
}
