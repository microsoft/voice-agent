// Loopback-only helper for the browser-direct cost walkthrough. It creates or reuses the Voice Agent,
// serves the page and hands the page a short-lived az-login token. Audio, Agent events and function
// calls never pass through this process. Ported from samples/ignite_planner/server.mjs.
//
//   node server.mjs [--port 8780] [--env-file PATH] [--preview]
import {existsSync, readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {AzureCliToken, agentDefinition, agentName, ensureAgent, validateEndpoint, websocketUrl} from './agent/agent.mjs';

const HERE = new URL('./', import.meta.url);
const TYPES = {'.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json'};
// Exact files only, served under flat URLs: the page in web/ and the function schemas from agent/,
// so the page can list the Agent's functions as defined.
export const ASSETS = Object.fromEntries([
  ...['index.html', 'styles.css', 'app.mjs', 'inputs.mjs', 'rate-card.mjs', 'steps.mjs', 'cost-tree.mjs', 'concepts.mjs', 'savings.mjs', 'stage.mjs', 'result.mjs', 'pricing.mjs', 'response-model.mjs',
    'page-tools.mjs', 'voice.mjs', 'voice-session.mjs', 'audio.mjs', 'pcm-capture.js', 'wireframe.mjs', 'effects.mjs',
    'conversation-log.mjs', 'share.mjs', 'export.mjs', 'xlsx.mjs'].map(name => [name, new URL(`web/${name}`, HERE)]),
  ['tools.json', new URL('agent/tools.json', HERE)],
]);
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export function settingsFromEnv(env = process.env, preview = false) {
  const endpoint = preview ? '' : (env.AZURE_VOICE_AGENTS_ENDPOINT || '').trim();
  return {
    endpoint: endpoint && validateEndpoint(endpoint),
    model: env.AZURE_VOICE_AGENTS_MODEL || 'gpt-realtime',
    voice: env.AZURE_VOICE_AGENTS_VOICE || 'en-US-AvaNeural',
  };
}

export function createApp({settings, agent = null, tokens = new AzureCliToken(), log = console.log}) {
  const azureOrigin = settings.endpoint ? new URL(settings.endpoint).origin.replace(/^https:/, 'wss:') : '';
  const headers = {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'microphone=(self)',
    'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'${azureOrigin && ` ${azureOrigin}`}; ` +
      "media-src 'self' blob:; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  };
  const reply = (response, status, body, type = 'text/plain; charset=utf-8') => {
    response.writeHead(status, {...headers, 'Content-Type': type});
    response.end(body);
  };
  return createServer(async (request, response) => {
    const host = request.headers.host || '';
    const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
    if (!LOOPBACK.has(hostname)) return reply(response, 403, 'This sample accepts loopback Host only.');
    let pathname;
    try { ({pathname} = new URL(request.url, `http://${host}`)); }
    catch { return reply(response, 400, 'Bad request target.'); }
    if (request.method === 'POST' && pathname === '/api/token') {
      // Only this page may receive the developer's token: same loopback origin, never another site.
      if (request.headers.origin !== `http://${host}`) return reply(response, 403, 'A same-origin page is required.');
      if (!agent) return reply(response, 503, 'Voice is not configured; the server runs in preview mode.');
      try {
        const {token, expires_on: expiresOn} = await tokens.get();
        log('Gave the page a short-lived Azure token for one voice session.');
        return reply(response, 200, JSON.stringify({token, expires_on: expiresOn}), TYPES['.json']);
      } catch (error) {
        return reply(response, 500, `Azure token request failed: ${error.message}. Run az login.`);
      }
    }
    if (request.method !== 'GET') return reply(response, 405, 'Method not allowed.');
    if (pathname === '/api/config') {
      return reply(response, 200, JSON.stringify({
        voice_available: Boolean(agent), voice: settings.voice, model: settings.model,
        agent_name: agent?.name ?? null, websocket_url: agent ? websocketUrl(settings.endpoint, agent.name) : null,
        transport: 'browser-direct', local_only: true,
      }), TYPES['.json']);
    }
    const file = ASSETS[pathname === '/' ? 'index.html' : pathname.slice(1)];
    if (!file) return reply(response, 404, 'Not found.');
    return reply(response, 200, readFileSync(file), TYPES[pathname === '/' ? '.html' : pathname.slice(pathname.lastIndexOf('.'))]);
  });
}

async function main() {
  const {values} = parseArgs({options: {
    port: {type: 'string', default: '8780'}, 'env-file': {type: 'string'}, preview: {type: 'boolean', default: false},
  }});
  const envFile = values['env-file'] ?? (existsSync(new URL('.env', HERE)) ? fileURLToPath(new URL('.env', HERE)) : null);
  if (envFile) process.loadEnvFile(envFile);
  const settings = settingsFromEnv(process.env, values.preview);
  const tokens = new AzureCliToken();
  let agent = null;
  if (settings.endpoint) {
    const definition = agentDefinition(settings);
    const name = agentName(definition);
    const {token} = await tokens.get();
    agent = await ensureAgent({endpoint: settings.endpoint, definition, name, token});
    console.log(`${agent.created ? 'Created' : 'Reusing'} Voice Agent ${name} (retained; delete it in Foundry when finished).`);
  } else {
    console.log('Preview mode: no Azure calls. Set AZURE_VOICE_AGENTS_ENDPOINT for real voice.');
  }
  const port = Number(values.port);
  createApp({settings, agent, tokens}).listen(port, '127.0.0.1', () => {
    console.log(`Cost walkthrough (browser-direct voice) on http://127.0.0.1:${port}`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
