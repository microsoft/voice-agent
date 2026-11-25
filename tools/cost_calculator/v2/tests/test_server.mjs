import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {request} from 'node:http';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {agentDefinition, agentName} from '../agent/agent.mjs';
import {ASSETS, createApp, settingsFromEnv} from '../server.mjs';

async function withServer(options, run) {
  const server = createApp({log: () => {}, ...options});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(base); } finally { server.close(); }
}

test('every served file exists', () => {
  for (const [name, url] of Object.entries(ASSETS)) assert.ok(existsSync(fileURLToPath(url)), name);
});

test('preview mode serves the page and reports voice as unavailable', async () => {
  await withServer({settings: settingsFromEnv({}, true)}, async base => {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    const config = await (await fetch(`${base}/api/config`)).json();
    assert.equal(config.voice_available, false);
    assert.equal((await fetch(`${base}/inputs.mjs`)).status, 200);
    assert.equal((await fetch(`${base}/../server.mjs`)).status, 404);
    assert.equal((await fetch(`${base}/prompt.txt`)).status, 404);
  });
});

test('the token goes only to a same-origin loopback page', async () => {
  const tokens = {get: async () => ({token: 'secret', expires_on: 1})};
  await withServer({settings: settingsFromEnv({}, true), agent: {name: 'a'}, tokens}, async base => {
    assert.equal((await fetch(`${base}/api/token`, {method: 'POST'})).status, 403);
    assert.equal((await fetch(`${base}/api/token`, {method: 'POST', headers: {origin: 'http://evil.example'}})).status, 403);
    const ok = await fetch(`${base}/api/token`, {method: 'POST', headers: {origin: base}});
    assert.equal((await ok.json()).token, 'secret');
    // fetch drops a custom Host header, so send this one with http.request.
    const status = await new Promise((resolve, reject) => {
      const {hostname, port} = new URL(base);
      request({hostname, port, path: '/', headers: {host: 'example.com'}}, response => { response.resume(); resolve(response.statusCode); })
        .on('error', reject).end();
    });
    assert.equal(status, 403);
  });
});

test('the Agent name follows its definition', () => {
  const definition = agentDefinition({});
  assert.match(agentName(definition), /^cost-walkthrough-js-[0-9a-f]{10}$/);
  assert.notEqual(agentName(definition), agentName(agentDefinition({voice: 'en-US-Ava:DragonHDLatestNeural'})));
  assert.equal(definition.tools.length, 8);
  assert.equal(definition.audio.input.turn_detection.create_response, false);
});
