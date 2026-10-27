// Offline server tests: a real HTTP/WebSocket server, a `ws` client standing in for the
// browser, and the real Projects SDK talking to an in-memory project and scripted Live endpoint.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import WebSocket from "ws";

import { main } from "../server.mjs";
import { DATETIME_TOOL_NAME, MCP_SERVER_URL } from "../tools.mjs";
import { ENV, MANAGED, OfflineProject, ScriptedLive, clientOptions, credential, live } from "./offline.mjs";

const MICROPHONE = Buffer.from(Array.from({ length: 4800 }, (_, index) => index % 256));

/** Starts the sample on a free port with offline stand-ins. */
async function start({ argv = [], env = ENV, project = new OfflineProject(), events = [] } = {}) {
  const liveEndpoint = new ScriptedLive(events);
  const lines = [];
  const running = await main({
    argv: [...argv, "--port", "0"],
    env,
    credential,
    clientOptions: clientOptions(project, liveEndpoint),
    log: (line) => lines.push(line),
  });
  return { running, project, liveEndpoint, lines };
}

/**
 * Acts as the browser page: waits for "ready", sends one microphone chunk, then "stop" once
 * the scripted events have arrived. Resolves with every server message after the socket closes.
 */
function browser(port, { origin = `http://localhost:${port}`, stopAfterMs = 80 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/live`, { origin });
    const messages = [];
    socket.on("message", async (data) => {
      const message = JSON.parse(String(data));
      messages.push(message);
      if (message.type === "ready") {
        socket.send(MICROPHONE);
        await sleep(stopAfterMs);
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "stop" }));
      }
    });
    socket.on("close", () => resolve(messages));
    socket.on("error", reject);
  });
}

const ofType = (messages, type) => messages.filter((message) => message.type === type);

describe("Responses delegation server", () => {
  it("relays microphone audio, transcripts, delegation, and teacher audio, then cleans up", async () => {
    const { running, project, liveEndpoint, lines } = await start({
      argv: ["--auto-delete"],
      events: [
        live.started("conversation-1"),
        live.user("I goed to school."),
        live.delegation("delegation-1", "responses"),
        live.backend("delegation-1", "response.created"),
        live.backend("delegation-1", "response.output_text.delta", { delta: "Say: I went." }),
        live.backend("delegation-1", "response.completed"),
        live.teacher("I went to school."),
        live.audio([1, 2, 3, 4]),
      ],
    });
    const messages = await browser(running.port);
    await running.stop();

    const [agent] = project.created;
    assert.equal(ofType(messages, "ready")[0].conversationId, "conversation-1");
    assert.deepEqual(ofType(messages, "transcript"), [
      { type: "transcript", role: "user", delta: "I goed to school." },
      { type: "transcript", role: "teacher", delta: "I went to school." },
    ]);
    assert.deepEqual(
      ofType(messages, "delegation").map(({ status, delta }) => [status, delta ?? ""]),
      [
        ["Delegation requested", ""],
        ["Backend response started", ""],
        ["Receiving backend guidance", "Say: I went."],
        ["Backend response completed", ""],
      ],
    );
    assert.equal(ofType(messages, "delegation")[0].title, "Delegation → text-model");
    assert.deepEqual(ofType(messages, "audio"), [{ type: "audio", delta: Buffer.from([1, 2, 3, 4]).toString("base64") }]);
    const closed = ofType(messages, "closed")[0];
    assert.equal(closed.conversationId, "conversation-1");
    assert.equal(closed.closeReason, "close_requested");

    // The SDK handshake targets the created agent's pinned version with the preview header.
    const [{ url, headers }] = liveEndpoint.connects;
    const parsed = new URL(url);
    assert.equal(parsed.pathname, `/api/projects/test/agents/${agent.name}/endpoint/protocols/voice/live/sessions`);
    assert.equal(parsed.searchParams.get("x-agent-version-override"), "3");
    assert.equal(headers.authorization, "Bearer offline-test-token");
    assert.equal(headers["foundry-features"], "VoiceAgents=V1Preview");
    // Raw browser PCM reaches the service base64-encoded; the client then closes gracefully.
    assert.deepEqual(
      liveEndpoint.received.filter((command) => command.type === "session.input_audio.append").map((command) => command.audio),
      [MICROPHONE.toString("base64")],
    );
    assert.equal(liveEndpoint.commands().at(-1), "session.close");
    // --auto-delete: no download command for an agent that is about to be deleted.
    assert.ok(lines.includes("Conversation id: conversation-1"));
    assert.ok(!lines.some((line) => line.includes("download_conversation_artifacts.py")));
    assert.deepEqual(project.deleted, [agent.name]);
  });

  it("keeps agents by default and prints the download command", async () => {
    const { running, project, lines } = await start({ events: [live.started("conversation-kept")] });
    await browser(running.port);
    await running.stop();
    assert.deepEqual(project.deleted, []);
    assert.ok(lines.some((line) => /download_conversation_artifacts\.py" ".+" "conversation-kept"/.test(line)));
    assert.ok(lines.some((line) => line.startsWith("Kept agent: ")));
  });

  it("answers a client delegation with commentary tied to its ID", async () => {
    const { running, liveEndpoint } = await start({
      events: [live.started("c"), live.delegation("delegation-client", "client")],
    });
    await browser(running.port);
    await running.stop();
    const commentary = liveEndpoint.received.filter((command) => command.type === "session.commentary.append");
    assert.equal(commentary.length, 1);
    assert.equal(commentary[0].delegation_id, "delegation-client");
  });

  it("reports a backend failure or a lost upstream connection and ends the session", async () => {
    for (const [events, message] of [
      [[live.started("c"), live.delegation("d", "responses"), live.backend("d", "response.failed")], /response\.failed/],
      [[live.started("c"), live.closed("connection_lost")], /connection was lost/],
    ]) {
      const { running } = await start({ events });
      const messages = await browser(running.port, { stopAfterMs: 500 });
      await running.stop();
      assert.match(ofType(messages, "error")[0].message, message);
      assert.equal(ofType(messages, "closed").length, 1);
    }
  });
});

describe("managed prompt-agent server", () => {
  it("shows Foundry-managed delegation and never runs the prompt agent itself", async () => {
    const { running, project, liveEndpoint } = await start({
      argv: ["--managed", "--auto-delete"],
      events: [
        live.started("conversation-managed"),
        live.delegation("delegation-managed", "foundry_managed_agent"),
        live.backend("delegation-managed", "response.created"),
        live.backend("delegation-managed", "response.output_text.delta", { delta: "[commentary] I went." }),
        live.commentary(),
        live.backend("delegation-managed", "response.completed"),
        live.teacher("I went to school yesterday."),
      ],
    });
    const messages = await browser(running.port);
    await running.stop();
    const [prompt, voice] = project.created;
    const delegation = ofType(messages, "delegation");
    assert.equal(delegation[0].title, `Managed delegation → ${prompt.name}:7`);
    assert.deepEqual(delegation.map((message) => message.status), [
      "Prompt agent delegation requested",
      "Backend response started",
      "Receiving backend guidance",
      "Accepted commentary forwarded to GPT Live",
      "Backend response completed; accepted guidance forwarded to GPT Live",
    ]);
    assert.ok(delegation.every((message) => message.id === "delegation-managed"));
    // The client only streams audio and closes; Foundry runs the prompt agent.
    assert.deepEqual([...new Set(liveEndpoint.commands())], ["session.input_audio.append", "session.close"]);
    assert.equal(new URL(liveEndpoint.connects[0].url).searchParams.get("x-agent-version-override"), "3");
    assert.deepEqual(project.deleted, [voice.name, prompt.name]);
  });

  it("creates the tools prompt agent and returns local function results on the session", async () => {
    const call = { type: "function_call", call_id: "call-1", name: DATETIME_TOOL_NAME, arguments: "{}" };
    const { running, project, liveEndpoint } = await start({
      argv: ["--managed", "--auto-delete"],
      events: [
        live.started("conversation-tools", MANAGED),
        live.delegation("delegation-tools", "foundry_managed_agent"),
        live.backend("delegation-tools", "response.created", { response: { id: "response-1" } }),
        live.backend("delegation-tools", "response.output_item.done", { item: call }),
        live.backend("delegation-tools", "response.completed", { response: { id: "response-1", output: [] } }),
        live.teacher("It's 1:54 PM."),
      ],
    });
    const config = await (await fetch(`http://127.0.0.1:${running.port}/config`)).json();
    const messages = await browser(running.port);
    await running.stop();
    const [prompt, voice] = project.created;
    assert.deepEqual(prompt.definition.tools.map((tool) => tool.type), ["mcp", "function"]);
    assert.equal(prompt.definition.tools[0].server_url, MCP_SERVER_URL);
    assert.match(voice.definition.instructions, /MCP calculator and a client-computer clock function/);
    assert.match(config.delegation, /MCP calculator, local date\/time function/);
    // The function output and one continuation go out on the same Live socket.
    const commands = liveEndpoint.received.filter((command) => command.type.startsWith("response."));
    assert.deepEqual(commands.map((command) => command.type), ["response.item.create", "response.create"]);
    assert.equal(commands[0].item.type, "function_call_output");
    assert.equal(commands[0].item.call_id, "call-1");
    assert.ok("utc_datetime" in JSON.parse(commands[0].item.output));
    assert.ok(
      ofType(messages, "delegation").some(
        (message) =>
          message.title === "Managed prompt-agent tools" &&
          message.status === "Local function results sent; resuming the prompt agent",
      ),
    );
  });

  it("rejects native client or responses targets without a fallback", async () => {
    for (const target of ["client", "responses"]) {
      const { running, liveEndpoint } = await start({
        argv: ["--managed"],
        events: [live.started("c"), live.delegation("d", target)],
      });
      const messages = await browser(running.port, { stopAfterMs: 500 });
      await running.stop();
      assert.match(ofType(messages, "error")[0].message, new RegExp(`delegation target '${target}'`));
      assert.ok(!liveEndpoint.commands().some((type) => /commentary|thinking|response\./.test(type)));
    }
  });
});

describe("HTTP surface", () => {
  it("serves only the page files and the agent configuration", async () => {
    const { running, project } = await start();
    const base = `http://127.0.0.1:${running.port}`;
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /GPT Live English teacher/);
    for (const path of ["/app.js", "/pcm-audio.js", "/pcm-capture.js", "/style.css"]) {
      assert.equal((await fetch(base + path)).status, 200, path);
    }
    for (const path of ["/server.mjs", "/../agents.mjs", "/%2e%2e/agents.mjs", "/package.json"]) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
    const config = await (await fetch(`${base}/config`)).json();
    assert.deepEqual(config, {
      agent: project.created[0].name, version: "3", delegation: "Responses", backend: "text-model",
    });
    await running.stop();
  });

  it("refuses Live connections from other origins", async () => {
    const { running, liveEndpoint } = await start({ events: [live.started("c")] });
    await assert.rejects(browser(running.port, { origin: "https://example.com" }), /403/);
    assert.deepEqual(liveEndpoint.connects, []);
    await running.stop();
  });
});
