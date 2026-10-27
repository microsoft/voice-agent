// Opens GPT Live sessions with the SDK's VoiceAgentLiveClient over a WebSocket transport the
// sample supplies through the public webSocketFactory option.
//
// Why a sample-owned transport: in Foundry-managed delegation, local function results go back
// to the prompt agent with response.item.create and response.create, as the Python tools sample
// does. This preview JS SDK refuses both commands unless the session uses Responses delegation,
// and does not export its own transport, so the sample keeps a handle on its transport and sends
// those two commands directly. Everything else still goes through the SDK connection.
import { VoiceAgentLiveClient } from "@azure/ai-projects";
import WebSocket from "ws";

/** A minimal Node.js transport for the SDK's Live client, built on `ws`. */
export class NodeWebSocketTransport {
  setHandlers(handlers) {
    this.handlers = handlers;
  }

  async connect({ url, protocols, headers, connectionTimeoutInMs, abortSignal }) {
    if (abortSignal?.aborted) throw new Error("WebSocket connection was cancelled.");
    // Unlike the SDK's built-in transport, this does not apply HTTPS_PROXY settings.
    const socket = new WebSocket(url, protocols, { headers, perMessageDeflate: true });
    this.socket = socket;
    socket.on("message", (data, isBinary) =>
      this.handlers?.onMessage(isBinary ? new Uint8Array(Buffer.concat([].concat(data))).buffer : data.toString()),
    );
    socket.on("close", (code, reason) => this.handlers?.onClose(code, reason.toString(), code === 1000 || code === 1001));
    socket.on("error", (error) => this.handlers?.onError(error));
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => fail(new Error(`WebSocket connection timed out after ${connectionTimeoutInMs}ms.`)), connectionTimeoutInMs);
      const onAbort = () => fail(new Error("WebSocket connection was cancelled."));
      const settle = () => {
        clearTimeout(timeout);
        abortSignal?.removeEventListener("abort", onAbort);
        socket.off("open", onOpen);
        socket.off("error", fail);
      };
      const onOpen = () => {
        settle();
        resolve();
      };
      function fail(error) {
        settle();
        socket.terminate();
        reject(error);
      }
      socket.once("open", onOpen);
      socket.once("error", fail);
      abortSignal?.addEventListener("abort", onAbort);
    });
  }

  send(data) {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error("WebSocket is not connected."));
    return new Promise((resolve, reject) => this.socket.send(data, (error) => (error ? reject(error) : resolve())));
  }

  async close(code, reason) {
    const socket = this.socket;
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
    else if (socket.readyState === WebSocket.OPEN) socket.close(code, reason);
    // Best effort: give the close handshake 5 seconds, then drop the socket.
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        socket.terminate();
        resolve();
      }, 5000);
      socket.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
}

export const nodeWebSocketFactory = { create: () => new NodeWebSocketTransport() };

/**
 * Opens a Live session for `agent` and resolves once Foundry sends session.started, with
 * the SDK connection and sendRaw(event), which sends a client command on the same socket.
 */
export async function openLiveSession({ endpoint, credential, webSocketFactory = nodeWebSocketFactory }, agent) {
  let transport;
  const live = new VoiceAgentLiveClient(endpoint, credential, {
    webSocketFactory: { create: () => (transport = webSocketFactory.create()) },
  });
  const connection = await live.connect(agent.name, { agentVersionOverride: agent.version });
  return { connection, sendRaw: (event) => transport.send(JSON.stringify(event)) };
}
