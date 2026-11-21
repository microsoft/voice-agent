// The voice island: connect to the Voice Agent, play its voice, show captions and run its function
// calls on the page. Ported from samples/ignite_planner/web/app.mjs (connect, receive, executeCall,
// whenSpoken) without the planner-specific parts.
import {VoiceAudio} from './audio.mjs';
import {VoiceSession} from './voice-session.mjs';
import {ConversationLog} from './conversation-log.mjs';
import {PAGE_TOOLS} from './page-tools.mjs';

const $ = id => document.getElementById(id);
const STATE_LABELS = {offline: 'OFFLINE', connecting: 'CONNECTING', listening: 'LISTENING', hearing: 'HEARING YOU',
  thinking: 'THINKING', acting: 'ON THE PAGE', speaking: 'SPEAKING'};

export class VoiceGuide {
  // execute(name, args) runs one page function and returns its JSON result; onAction(name, args) lets
  // the page draw a beam; config is /api/config.
  constructor({config, execute, onAction = () => {}, onTranscript = () => {}, onResponseDone = () => {}, onInterrupted = () => {}}) {
    Object.assign(this, {config, execute, onAction, onTranscript, onResponseDone, onInterrupted});
    this.socket = this.session = this.audio = this.stream = this.conversation = null;
    this.ready = this.connecting = this.responding = this.speaking = this.userSpeaking = false;
    this.generation = 0;
    this.completed = new Map();
    this.pending = [];
    this.actingUntil = 0;
    this.captionResponse = null;
    this.captionText = '';
    this.visualCache = {at: 0, value: null};
  }

  // One reading per frame for the orbs: state, levels and the spectrum of whoever is talking.
  visual() {
    const now = performance.now();
    if (now - this.visualCache.at < 8 && this.visualCache.value) return this.visualCache.value;
    const live = this.audio && !this.audio.disposed;
    const levels = live ? this.audio.levels() : {input: 0, output: 0};
    let state = 'offline';
    if (Date.now() < this.actingUntil) state = 'acting';
    else if (this.connecting && !this.ready) state = 'connecting';
    else if (this.ready) state = this.speaking ? 'speaking' : this.userSpeaking ? 'hearing' : this.responding ? 'thinking' : 'listening';
    const source = this.speaking ? 'output' : this.ready && ['hearing', 'listening'].includes(state) ? 'input' : null;
    this.visualCache = {at: now, value: {state, ...levels, spectrum: live && source ? this.audio.spectrum(source) : null}};
    return this.visualCache.value;
  }

  refreshState() {
    const {state} = this.visual();
    const label = $('agent-state');
    if (label.dataset.state !== state) { label.dataset.state = state; label.textContent = STATE_LABELS[state]; }
  }

  // Function calls arrive when the reply is generated, seconds before its audio plays. A visual
  // change waits until the speech queued ahead of it has been heard; an interruption applies it now.
  whenSpoken(apply) {
    const wait = this.audio && !this.audio.disposed && this.speaking ? this.audio.snapshot().bufferedSeconds * 1000 - 120 : 0;
    if (wait < 150) { apply(); return; }
    const entry = {apply, timer: setTimeout(() => { this.pending = this.pending.filter(item => item !== entry); apply(); }, wait)};
    this.pending.push(entry);
  }

  flush() {
    const pending = this.pending;
    this.pending = [];
    for (const entry of pending) { clearTimeout(entry.timer); entry.apply(); }
  }

  caption(text, role = 'agent') {
    $('live-caption').dataset.role = role;
    $('live-caption').textContent = text.length > 360 ? `…${text.slice(-358)}` : text;
  }

  message(role, text) {
    const row = document.createElement('p');
    row.textContent = `${role.toUpperCase()}: ${text}`;
    $('transcript').append(row);
    while ($('transcript').children.length > 30) $('transcript').firstElementChild.remove();
  }

  showError(text) {
    $('error').textContent = text;
    $('error').hidden = false;
  }

  status() {
    if (!this.ready) return;
    $('send').disabled = false;
    $('voice-status').textContent = this.speaking ? 'Guide speaking — you can interrupt.'
      : this.responding ? 'Working on the page — you can interrupt.' : 'Listening. Just talk, or press ⌨ to type.';
    this.refreshState();
  }

  send(packet) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('Start the cost guide first.');
    if (this.socket.bufferedAmount > 512 * 1024) throw new Error('Voice upload is falling behind. Please reconnect.');
    this.socket.send(JSON.stringify(packet));
  }

  sendText(text) {
    if (!this.session || !this.ready) throw new Error('Start the cost guide first.');
    this.session.sendText(text);
    this.message('You', text);
    this.caption(`“${text}”`, 'you');
  }

  // A page event the Agent sees on its next turn, without starting or interrupting a reply.
  note(text) {
    if (this.ready) this.session?.note(`[Page event] ${text}`);
  }

  fail(error) {
    this.showError(error.message);
    void this.disconnect().catch(other => this.showError(other.message));
  }

  // One validated, idempotent function call.
  executeCall(call) {
    const {call_id: callId, name, arguments: raw} = call;
    if (typeof callId !== 'string' || !callId || typeof name !== 'string' || typeof raw !== 'string')
      throw new Error('Function call is missing its ID, name or JSON arguments.');
    if (this.completed.has(callId)) {
      const previous = this.completed.get(callId);
      if (previous.name !== name || previous.raw !== raw) throw new Error('A function call ID was reused with different arguments.');
      return previous.result;
    }
    if (this.completed.size >= 256) throw new Error('Demo function-call limit reached. Reconnect.');
    let args;
    try { args = JSON.parse(raw); }
    catch { return {ok: false, error: {code: 'invalid_json', message: 'Function arguments were not valid JSON.'}}; }
    if (!PAGE_TOOLS.has(name) || !args || typeof args !== 'object' || Array.isArray(args))
      return {ok: false, error: {code: 'unsupported_tool', message: 'Only the documented page functions are allowed.'}};
    this.conversation?.record('tool.call', {call_id: callId, name, arguments: args});
    this.responding = true;
    this.actingUntil = Date.now() + 900;
    $('last-action').textContent = `▸ ${name.replaceAll('_', ' ')}`;
    $('last-action').hidden = false;
    this.onAction(name, args);
    const result = this.execute(name, args);
    this.completed.set(callId, {name, raw, result});
    this.conversation?.record('tool.result', {call_id: callId, name, result});
    this.status();
    return result;
  }

  receive(event) {
    if (event.type === 'session.ready') {
      this.ready = true; this.connecting = false;
      $('connect').textContent = 'End conversation ×';
      $('agent-live').dataset.live = 'true';
      $('agent-live').textContent = 'LIVE';
      $('message').disabled = false;
      this.status();
    } else if (event.type === 'response.created') {
      this.responding = true;
      this.captionResponse = event.response?.id;
      this.captionText = '';
      this.status();
    } else if (event.type === 'response.done') {
      this.responding = false;
      this.status();
      this.onResponseDone(event);
      if (['failed', 'incomplete'].includes(event.response?.status))
        this.showError(`The guide's response was ${event.response.status}. No successful action should be assumed.`);
    } else if (['response.output_audio_transcript.delta', 'response.audio_transcript.delta'].includes(event.type)) {
      if (event.response_id === this.captionResponse && !this.audio?.blockedResponses.has(event.response_id)) {
        this.captionText += event.delta || '';
        this.caption(this.captionText);
        this.onTranscript(event.delta || '');
      }
    } else if (event.type === 'playback.interrupted') {
      this.onInterrupted();
      this.flush();
      if (event.cut_audio) this.caption('');
      $('voice-status').textContent = 'Listening to you…';
    } else if (event.type === 'input_audio_buffer.speech_started') {
      this.userSpeaking = true;
      this.refreshState();
    } else if (event.type === 'input_audio_buffer.committed') {
      this.userSpeaking = false;
      this.refreshState();
    } else if (['response.output_audio_transcript.done', 'response.audio_transcript.done'].includes(event.type)) {
      if (event.transcript) this.message('Guide', event.transcript);
    } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
      this.message('You', event.transcript);
      this.caption(`“${event.transcript}”`, 'you');
    } else if (event.type === 'error') {
      throw new Error(event.error?.message || 'The voice service reported an error.');
    }
  }

  async enableMicrophone(audio, generation) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access requires HTTPS or localhost.');
    const captured = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true}, video: false});
    if (generation !== this.generation) { captured.getTracks().forEach(track => track.stop()); return; }
    this.stream = captured;
    await audio.capture(captured, chunk => {
      if (!this.ready) return;
      try { this.send({type: 'input_audio_buffer.append', audio: chunk}); }
      catch (error) { this.fail(error); }
    });
  }

  async connect() {
    if (this.connecting) return;
    if (this.socket) return this.disconnect();
    const generation = ++this.generation;
    $('error').hidden = true;
    this.connecting = true;
    this.refreshState();
    $('use-mic').disabled = true;
    $('voice-status').textContent = 'Connecting to the cost guide…';
    try {
      const audio = new VoiceAudio(value => { this.speaking = value; this.status(); }, () => {}, error => this.fail(error));
      this.audio = audio;
      const bridged = this.config.transport === 'playground-bridge';
      let token = null;
      if (!bridged) {
        const response = await fetch('api/token', {method: 'POST', cache: 'no-store'});
        if (!response.ok) throw new Error(`The local server could not provide an Azure token: ${await response.text()}`);
        ({token} = await response.json());
        if (generation !== this.generation) return;
      }
      await audio.resumed;
      if (generation !== this.generation) return;
      this.conversation = new ConversationLog({transport: this.config.transport, agent_name: this.config.agent_name});
      this.completed = new Map();
      // A browser WebSocket cannot set an Authorization header: Foundry accepts the bearer token as a
      // second subprotocol. Through the Playground the sign-in cookie goes with the handshake instead.
      const url = new URL(this.config.websocket_url, location.href);
      if (bridged) url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = bridged ? new WebSocket(url) : new WebSocket(this.config.websocket_url, ['realtime', `authorization.bearer.${token}`]);
      const session = new VoiceSession({send: packet => this.send(packet), audio, execute: call => this.executeCall(call),
        emit: event => this.receive(event), fail: error => this.fail(error),
        // Set, start, nine steps and the result are 12 page actions in one turn; allow some slack.
        maxToolRounds: 16});
      this.socket = socket;
      this.session = session;
      setTimeout(() => { if (this.session === session && !this.ready) this.fail(new Error('The voice session did not become ready within 45 seconds.')); }, 45000);
      this.watchdog = setInterval(() => {
        if (this.session === session && session.expired()) this.fail(new Error('The guide did not finish its response within 120 seconds.'));
      }, 1000);
      socket.onopen = () => { $('voice-status').textContent = 'Preparing the cost guide…'; };
      socket.onmessage = event => {
        if (this.socket !== socket) return;
        try {
          const packet = JSON.parse(event.data);
          this.conversation.protocol(packet);
          session.handle(packet);
        } catch (error) { this.fail(error); }
      };
      socket.onerror = () => this.showError('The voice connection failed. Check az login and the Foundry endpoint.');
      socket.onclose = event => { if (this.socket === socket) this.fail(new Error(`The voice connection closed (code ${event.code}). Please reconnect.`)); };
      if ($('use-mic').checked) {
        void this.enableMicrophone(audio, generation).catch(error => {
          if (generation !== this.generation) return;
          this.stream?.getTracks().forEach(track => track.stop());
          this.stream = null;
          $('use-mic').checked = false;
          $('message-form').hidden = false;
          this.showError(`Microphone unavailable: ${error.message} You can still hear the guide and type.`);
        });
      }
    } catch (error) {
      if (generation !== this.generation) return;
      this.showError(error.message);
      await this.disconnect();
    }
  }

  async disconnect() {
    this.generation++;
    this.flush();
    this.ready = this.connecting = this.responding = this.speaking = this.userSpeaking = false;
    clearInterval(this.watchdog);
    const socket = this.socket;
    this.socket = this.session = null;
    socket?.close();
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    const audio = this.audio;
    this.audio = null;
    if (audio) await audio.dispose();
    $('connect').textContent = 'Start voice ↗';
    $('agent-live').dataset.live = 'false';
    $('agent-live').textContent = 'OFFLINE';
    $('use-mic').disabled = false;
    $('message').disabled = true;
    $('send').disabled = true;
    $('voice-status').textContent = 'Disconnected. The page keeps your inputs.';
    this.caption('');
    this.refreshState();
  }
}
