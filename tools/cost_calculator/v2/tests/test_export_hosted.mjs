import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {COST_TOOLS} from '../agent/agent.mjs';
import {ASSETS} from '../server.mjs';
import {exportHosted} from '../tools/export_hosted.mjs';

test('the Playground export holds the page files and an Agent with the page functions and the cost advisor', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cost-export-'));
  try {
    const target = join(dir, 'cost');
    const names = exportHosted(target, {VOICE_PLAYGROUND_COST_MCP_URL: 'https://mcp.example/mcp/cost-advisor ',
      VOICE_PLAYGROUND_COST_MODEL: 'gpt-realtime-2.1'});
    assert.deepEqual(names, [...Object.keys(ASSETS), 'agent.json'].sort());
    const {name, definition} = JSON.parse(readFileSync(join(target, 'agent.json'), 'utf8'));
    assert.match(name, /^cost-walkthrough-js-[0-9a-f]{10}$/);
    assert.equal(definition.model, 'gpt-realtime-2.1');
    // The page schedules every response itself; a server-created response would talk over it.
    assert.equal(definition.audio.input.turn_detection.create_response, false);
    const functions = definition.tools.filter(tool => tool.type === 'function').map(tool => tool.name);
    const pageTools = JSON.parse(readFileSync(join(target, 'tools.json'), 'utf8')).map(tool => tool.name);
    assert.deepEqual(functions, pageTools);
    assert.ok(!functions.includes('show_savings'));
    const mcp = definition.tools.filter(tool => tool.type === 'mcp');
    assert.deepEqual(mcp, [{type: 'mcp', server_label: 'cost', server_url: 'https://mcp.example/mcp/cost-advisor',
      allowed_tools: [...COST_TOOLS], require_approval: 'never'}]);
    assert.match(definition.instructions, /cost_savings_tips/);
    assert.throws(() => exportHosted(target, {}), /is not empty/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
