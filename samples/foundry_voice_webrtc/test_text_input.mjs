import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('./public/app.js', import.meta.url), 'utf8');

async function setup(transport) {
  const elements = new Map();
  const makeElement = () => ({
    value: '', disabled: true, hidden: true, textContent: '', children: [],
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    remove() {}, setAttribute() {}, pause() {},
  });
  const element = id => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };
  const sent = [];
  const session = {
    transport, ready: false, ws: { readyState: 1, send: frame => sent.push(JSON.parse(frame)), close() {} },
    abort: new AbortController(),
  };
  const context = {
    document: { getElementById: element, createElement: makeElement },
    window: { addEventListener() {} }, WebSocket: { OPEN: 1 },
    crypto: webcrypto,
    fetch: async () => ({ ok: true, json: async () => ({ configured: true }) }),
    clearTimeout() {}, clearInterval() {}, setInterval: () => 1,
    validateAudioSession() {},
    session,
  };
  // Run the actual UI code with a minimal DOM, without browser audio imports.
  await vm.runInNewContext(`(async () => {
    ${source.replace(/^import .*;\r?\n/, '')}
    call = session;
    return {markReady, handleEvent, updateTextInput, stop};
  })()`, context).then(api => context.api = api);
  return { ...context.api, element, session, sent };
}

for (const transport of ['websocket', 'webrtc']) {
  test(`${transport}: sends text and a response request over the bridge socket`, async () => {
    const ui = await setup(transport);
    ui.element('text-input').value = '  Hello <world>  ';
    ui.updateTextInput();
    assert.equal(ui.element('send-text').disabled, true);
    ui.markReady(ui.session);
    assert.equal(ui.element('text-input').disabled, false);
    assert.equal(ui.element('send-text').disabled, false);
    let prevented = false;
    ui.element('text-form').onsubmit({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    const id = ui.sent[0].item.id;
    assert.equal(id.length, 32);
    assert.match(id, /^[a-f0-9]{32}$/);
    assert.deepEqual(ui.sent, [
      { type: 'conversation.item.create', item: {
        id, type: 'message', role: 'user',
        content: [{ type: 'input_text', text: 'Hello <world>' }],
      } },
      { type: 'response.create', response: { output_modalities: ['text'] } },
    ]);
    assert.equal(ui.element('text-input').value, '');
    assert.equal(ui.element('transcript').children[0].children[1].textContent, 'Hello <world>');
    ui.element('text-input').value = 'Next';
    ui.element('text-input').oninput();
    assert.equal(ui.element('send-text').disabled, true);
    ui.element('text-form').onsubmit({ preventDefault() {} });
    assert.equal(ui.sent.length, 2);
    await ui.handleEvent(ui.session, { type: 'response.created', response: { id: 'reply' } });
    await ui.handleEvent(ui.session, { type: 'response.output_text.delta', item_id: 'answer', delta: 'Hello back' });
    await ui.handleEvent(ui.session, { type: 'response.output_text.done', item_id: 'answer', text: 'Hello back' });
    assert.equal(ui.element('transcript').children[1].children[1].textContent, 'Hello back');
    await ui.handleEvent(ui.session, { type: 'response.done', response: { status: 'completed' } });
    assert.equal(ui.element('send-text').disabled, false);
    ui.stop();
    assert.equal(ui.element('text-input').disabled, true);
    assert.equal(ui.element('send-text').disabled, true);
  });

  test(`${transport}: rejects blank, oversized, speaking and disconnected submissions`, async () => {
    const ui = await setup(transport);
    ui.markReady(ui.session);
    for (const text of [' ', 'x'.repeat(4001)]) {
      ui.element('text-input').value = text;
      ui.element('text-form').onsubmit({ preventDefault() {} });
    }
    assert.equal(ui.sent.length, 0);
    assert.equal(ui.element('error').hidden, false);
    ui.element('text-input').value = 'Hello';
    await ui.handleEvent(ui.session, { type: 'input_audio_buffer.speech_started' });
    assert.equal(ui.element('send-text').disabled, true);
    ui.element('text-form').onsubmit({ preventDefault() {} });
    await ui.handleEvent(ui.session, { type: 'input_audio_buffer.speech_stopped' });
    ui.session.ws.readyState = 3;
    ui.updateTextInput();
    assert.equal(ui.element('text-input').disabled, true);
    ui.element('text-form').onsubmit({ preventDefault() {} });
    assert.equal(ui.sent.length, 0);
  });

  test(`${transport}: failed responses surface errors and allow retry`, async () => {
    const ui = await setup(transport);
    ui.markReady(ui.session);
    ui.element('text-input').value = 'Hello';
    await ui.handleEvent(ui.session, { type: 'response.created', response: { id: 'reply' } });
    assert.equal(ui.element('send-text').disabled, true);
    await ui.handleEvent(ui.session, { type: 'response.done', response: { status: 'failed' } });
    assert.equal(ui.element('error').hidden, false);
    assert.equal(ui.element('send-text').disabled, false);
  });

  test(`${transport}: send failures preserve the draft and disable the composer`, async () => {
    const ui = await setup(transport);
    ui.markReady(ui.session);
    ui.element('text-input').value = 'Keep my draft';
    ui.session.ws.send = () => { throw new Error('Socket send failed'); };
    ui.element('text-form').onsubmit({ preventDefault() {} });
    assert.equal(ui.element('text-input').value, 'Keep my draft');
    assert.equal(ui.element('text-input').disabled, true);
    assert.equal(ui.element('error').textContent, 'Socket send failed');
    assert.equal(ui.element('transcript').children.length, 0);
  });
}
