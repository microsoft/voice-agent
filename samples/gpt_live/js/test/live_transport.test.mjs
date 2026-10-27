// Offline tests for the sample's Node.js WebSocket transport against a local ws server.
import assert from "node:assert/strict";
import { once } from "node:events";
import { describe, it } from "node:test";
import { WebSocketServer } from "ws";

import { NodeWebSocketTransport } from "../live_transport.mjs";

async function localServer(onConnection) {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  server.on("connection", onConnection);
  return { server, url: `ws://127.0.0.1:${server.address().port}` };
}

function recordingTransport() {
  const transport = new NodeWebSocketTransport();
  const events = { messages: [], closes: [], errors: [] };
  transport.setHandlers({
    onMessage: (data) => events.messages.push(data),
    onClose: (code, reason, wasClean) => events.closes.push([code, reason, wasClean]),
    onError: (error) => events.errors.push(error),
  });
  return { transport, events };
}

describe("NodeWebSocketTransport", () => {
  it("sends handshake headers, relays text both ways, and closes cleanly", async () => {
    const received = [];
    let headers;
    const { server, url } = await localServer((socket, request) => {
      headers = request.headers;
      socket.on("message", (data) => received.push(String(data)));
      socket.send(JSON.stringify({ type: "session.started" }));
    });
    const { transport, events } = recordingTransport();
    await transport.connect({
      url,
      protocols: [],
      headers: { authorization: "Bearer offline", "foundry-features": "VoiceAgents=V1Preview" },
      connectionTimeoutInMs: 5000,
    });
    await transport.send(JSON.stringify({ type: "response.create" }));
    while (!events.messages.length || !received.length) await new Promise((resolve) => setTimeout(resolve, 10));
    await transport.close(1000, "done");
    server.close();

    assert.equal(headers.authorization, "Bearer offline");
    assert.equal(headers["foundry-features"], "VoiceAgents=V1Preview");
    assert.deepEqual(events.messages, ['{"type":"session.started"}']);
    assert.deepEqual(received, ['{"type":"response.create"}']);
    assert.deepEqual(events.closes, [[1000, "done", true]]);
    assert.deepEqual(events.errors, []);
  });

  it("rejects a failed handshake and refuses to send while disconnected", async () => {
    const { server, url } = await localServer(() => {});
    server.close();
    const { transport } = recordingTransport();
    await assert.rejects(transport.connect({ url, protocols: [], headers: {}, connectionTimeoutInMs: 5000 }));
    await assert.rejects(transport.send("{}"), /not connected/);
  });
});
