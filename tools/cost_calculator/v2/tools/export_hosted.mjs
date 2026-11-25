// Export the cost walkthrough as the static files the Voice Agent Playground serves under /cost/ (its Cost analysis
// tab): the page files that server.mjs serves and the Agent definition the Playground creates. Voice goes through
// the Playground's same-origin bridge, so nothing here needs Node at run time.
//
//   node tools/export_hosted.mjs <empty-or-missing-directory>
//
// VOICE_PLAYGROUND_COST_MCP_URL sets the cost advisor MCP (default: the public no-auth MCP route) and
// VOICE_PLAYGROUND_COST_MODEL the realtime model (default: agentDefinition's).
import {copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {agentDefinition, agentName} from '../agent/agent.mjs';
import {ASSETS} from '../server.mjs';

export function exportHosted(destination, env = process.env) {
  if (existsSync(destination) && readdirSync(destination).length) throw new Error(`${destination} is not empty.`);
  mkdirSync(destination, {recursive: true});
  for (const [name, source] of Object.entries(ASSETS)) copyFileSync(source, `${destination}/${name}`);
  const options = {};
  if (env.VOICE_PLAYGROUND_COST_MCP_URL) options.mcpUrl = env.VOICE_PLAYGROUND_COST_MCP_URL.trim();
  if (env.VOICE_PLAYGROUND_COST_MODEL) options.model = env.VOICE_PLAYGROUND_COST_MODEL.trim();
  const definition = agentDefinition(options);
  writeFileSync(`${destination}/agent.json`, JSON.stringify({name: agentName(definition), definition}));
  return readdirSync(destination).sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [destination] = process.argv.slice(2);
  if (!destination) throw new Error('Usage: node tools/export_hosted.mjs <directory>');
  console.log(`Exported ${exportHosted(destination).length} files to ${destination}`);
}
