// Relays one browser WebSocket to one GPT Live session opened with the Projects SDK.
// The browser sends raw PCM16 microphone chunks and {"type":"stop"}; the server sends
// JSON messages: status, ready, audio, transcript, delegation, error, and closed.
import { DemoError, RATE } from "./agents.mjs";

const BACKEND_STATUSES = {
  "response.created": "Backend response started",
  "response.in_progress": "Backend response in progress",
  "response.output_text.delta": "Receiving backend guidance",
  "response.completed": "Backend response completed",
  "response.failed": "Backend response failed",
  "response.incomplete": "Backend response incomplete",
  error: "Backend error",
};
const BACKEND_FAILURES = new Set(["error", "response.failed", "response.incomplete"]);
const CLIENT_DELEGATION_REPLY =
  "This demo uses a Responses backend, not a client executor. Please continue the English lesson.";

/**
 * Turns Live events into browser messages, as the Python samples' converse() loop does for
 * their terminal panes. Throws DemoError for failures that should end the session.
 */
export class LiveEventTranslator {
  constructor({ managedDelegation, backendModel, send, appendCommentary }) {
    this.managedDelegation = managedDelegation;
    this.backendModel = backendModel;
    this.send = send;
    this.appendCommentary = appendCommentary;
    this.title = managedDelegation ? "Managed delegation" : "Delegation";
    this.replied = new Set();
    this.forwarded = new Set();
    this.latestDelegation = undefined;
    this.ready = false;
    this.conversationId = undefined;
    this.closeReason = undefined;
    this.usageSeconds = undefined;
  }

  async handle(event) {
    switch (event.type) {
      case "session.started": {
        // Foundry adds conversation_id at the top level; it is not session.id.
        this.conversationId = event.conversation_id || undefined;
        const format = event.session?.audio?.format;
        if (format && (format.type !== "audio/pcm" || format.rate !== RATE)) {
          throw new DemoError("The negotiated format is not the requested PCM16/24 kHz.");
        }
        this.ready = true;
        this.send({ type: "ready", sessionId: event.session.id, conversationId: this.conversationId });
        break;
      }
      case "error":
      case "transport.failed":
        throw new DemoError(`Live error: ${event.error?.message ?? event.type}`);
      case "session.output_audio.delta":
        // Base64 PCM16 at 24 kHz, passed through for the browser to play.
        this.send({ type: "audio", delta: event.delta });
        break;
      case "session.input_transcript.delta":
        this.send({ type: "transcript", role: "user", delta: event.delta });
        break;
      case "session.output_transcript.delta":
        this.send({ type: "transcript", role: "teacher", delta: event.delta });
        break;
      case "session.delegation.created":
        await this.delegationCreated(event.delegation);
        break;
      case "response.event":
        this.backendEvent(event);
        break;
      case "session.commentary.appended":
      case "session.thinking.appended":
        if (this.managedDelegation && this.latestDelegation !== undefined) {
          // Foundry appends each accepted guidance section to GPT Live itself. The
          // acknowledgment carries no text or delegation ID, so mark the latest one.
          this.forwarded.add(this.latestDelegation);
          const section = event.type.split(".")[1];
          this.send({
            type: "delegation",
            id: this.latestDelegation,
            status: `Accepted ${section} forwarded to GPT Live`,
          });
        }
        break;
      case "session.closed":
        this.closeReason = event.reason;
        this.usageSeconds = event.usage?.seconds;
        if (event.reason === "connection_lost") {
          throw new DemoError("Upstream connection was lost; native finalization is not confirmed.");
        }
        break;
    }
  }

  async delegationCreated({ id, target }) {
    this.latestDelegation = id;
    if (this.managedDelegation) {
      // Managed sessions keep the native event, but Foundry reports itself as the owner:
      // the client must not execute the prompt agent or send commentary.
      if (target !== "foundry_managed_agent") {
        throw new DemoError(
          `Expected Foundry-managed delegation, but received delegation target '${target}'. ` +
            "Check that the service supports foundry_managed_agent with tagged_text; no client fallback was run.",
        );
      }
      this.send({
        type: "delegation",
        id,
        title: `${this.title} → ${this.backendModel}`,
        status: "Prompt agent delegation requested",
      });
      return;
    }
    this.send({
      type: "delegation",
      id,
      title: `${this.title} → ${target === "responses" ? this.backendModel : target}`,
      status: "Delegation requested",
    });
    if (target === "client" && !this.replied.has(id)) {
      this.replied.add(id);
      await this.appendCommentary(CLIENT_DELEGATION_REPLY, id);
    }
  }

  backendEvent(event) {
    // Backend guidance is not the spoken teacher transcript. In managed mode this is the
    // prompt agent's raw tagged-text output; Foundry validates it and forwards only
    // accepted sections to GPT Live.
    const backend = event.event ?? {};
    const kind = backend.type;
    const id = event.delegation_id ?? "uncorrelated-backend";
    if (kind in BACKEND_STATUSES) {
      let status = BACKEND_STATUSES[kind];
      if (kind === "response.completed" && this.forwarded.has(id)) {
        status += "; accepted guidance forwarded to GPT Live";
      }
      this.send({
        type: "delegation",
        id,
        title: `${event.delegation_id ? this.title : "Uncorrelated backend"} → ${this.backendModel}`,
        status,
        delta: kind === "response.output_text.delta" ? (backend.delta ?? "") : "",
      });
    }
    if (BACKEND_FAILURES.has(kind) && !this.managedDelegation) {
      throw new DemoError(`Teaching backend reported ${kind}; check its deployment and configuration.`);
    }
    // Foundry owns the managed fallback; keep the failure visible without retrying the
    // backend or interrupting GPT Live.
  }
}

/**
 * Opens a Live session for `agent`, relays it to the browser socket until either side stops,
 * and resolves with the session's conversation ID and close reason.
 */
export async function relaySession(socket, { project, agent, log = () => {} }) {
  const send = (message) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  };
  let connection;
  let stopping = false;
  let sending = Promise.resolve();
  const translator = new LiveEventTranslator({
    ...agent,
    send,
    appendCommentary: (content, delegationId) => connection.appendCommentary(content, { delegationId }),
  });
  const stop = () => {
    if (stopping) return;
    stopping = true;
    send({ type: "status", text: "Closing; waiting for session.closed..." });
    // Sends session.close, waits for session.closed, then closes the Live socket.
    connection?.close().catch((error) => log(`Live close failed: ${error.message}`));
  };

  socket.on("message", (data, isBinary) => {
    if (!isBinary) {
      let message;
      try {
        message = JSON.parse(String(data));
      } catch {
        message = undefined;
      }
      if (message?.type === "stop") stop();
      return;
    }
    if (!connection || stopping || !translator.ready) return;
    // Raw PCM16 microphone audio; the SDK base64-encodes it for session.input_audio.append.
    const pcm = data.subarray(0, data.length - (data.length % 2));
    sending = sending.then(() => connection.sendAudio(pcm)).catch(() => {});
  });
  socket.on("close", stop);

  let failure;
  try {
    send({ type: "status", text: `Connecting to ${agent.name} version ${agent.version}...` });
    // The SDK opens the agent's .../endpoint/protocols/voice/live/sessions WebSocket with the
    // project credential and preview header, and resolves once Foundry sends session.started.
    connection = await project.beta.voiceAgents.live.connect(agent.name, { agentVersionOverride: agent.version });
    if (stopping) {
      stopping = false;
      stop();
    }
    for await (const event of connection) await translator.handle(event);
  } catch (error) {
    failure = error;
    send({ type: "error", message: error instanceof DemoError ? error.message : `${error.name}: ${error.message}` });
    log(`Live session failed: ${error.message}`);
    stopping = true;
    await connection?.close().catch(() => {});
  }
  const result = {
    conversationId: translator.conversationId,
    closeReason: translator.closeReason,
    usageSeconds: translator.usageSeconds,
    failure,
  };
  send({ type: "closed", ...result, failure: undefined });
  if (socket.readyState === socket.OPEN) socket.close(1000, "Live session ended.");
  return result;
}
