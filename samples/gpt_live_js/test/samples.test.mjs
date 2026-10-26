// Offline payload, lifecycle, and Live event tests; no Azure resources or audio devices.
// The samples run on the real Projects SDK: agent REST calls go to an in-memory HTTP client,
// and the SDK's Live client talks to a scripted WebSocket transport.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { DemoError, readPcmWav, writePcmWav } from "../live_common.mjs";
import * as managed from "../prompt_agent_delegation.mjs";
import * as direct from "../response_delegation.mjs";

const ENDPOINT = "https://sample.services.ai.azure.com/api/projects/test";
const TIMING = { chunkMs: 1, idleMs: 30, maxMs: 5000 };
const credential = {
  getToken: async () => ({ token: "offline-test-token", expiresOnTimestamp: Date.now() + 3_600_000 }),
};

function headers(values) {
  const map = new Map(Object.entries(values));
  return {
    get: (name) => map.get(name.toLowerCase()),
    has: (name) => map.has(name.toLowerCase()),
    set: (name, value) => map.set(name.toLowerCase(), String(value)),
    delete: (name) => map.delete(name.toLowerCase()),
    toJSON: () => Object.fromEntries(map),
    [Symbol.iterator]: () => map.entries(),
  };
}

/** An in-memory Foundry project behind the real Projects SDK client. */
class OfflineProject {
  constructor(agents = {}, { failVoice = false } = {}) {
    this.agents = new Map(Object.entries(agents)); // name -> { version, definition }
    this.failVoice = failVoice;
    this.requests = [];
    this.created = [];
    this.deleted = [];
  }

  async sendRequest(request) {
    this.requests.push(request);
    const [status, body] = this.handle(request);
    return {
      request,
      status,
      headers: headers({ "content-type": "application/json" }),
      bodyAsText: JSON.stringify(body),
    };
  }

  version(name) {
    const { version, definition } = this.agents.get(name);
    return { object: "agent.version", id: `${name}:${version}`, name, version, created_at: 1, definition };
  }

  handle(request) {
    const path = new URL(request.url).pathname.slice(new URL(ENDPOINT).pathname.length);
    const [collection, name, ...rest] = path.split("/").filter(Boolean).map(decodeURIComponent);
    if (collection === "deployments" && request.method === "GET") {
      return [200, {
        name, type: "ModelDeployment", modelName: name, modelVersion: "1", modelPublisher: "OpenAI",
        capabilities: {}, sku: { name: "GlobalStandard", capacity: 1, family: "", size: "", tier: "" },
      }];
    }
    assert.equal(collection, "agents", `Unexpected request: ${request.method} ${request.url}`);
    if (request.method === "POST" && !name) {
      const body = JSON.parse(request.body);
      if (body.definition.kind === "voice" && this.failVoice) {
        return [400, { error: { code: "test_failure", message: "Test failure." } }];
      }
      this.created.push({
        name: body.name,
        definition: body.definition,
        features: request.headers.get("foundry-features"),
      });
      this.agents.set(body.name, { version: body.definition.kind === "prompt" ? "7" : "3", definition: body.definition });
      return [200, { object: "agent", id: body.name, name: body.name, versions: { latest: this.version(body.name) } }];
    }
    if (request.method === "DELETE") {
      this.deleted.push(name);
      return [200, { object: "agent.deleted", name, deleted: true }];
    }
    if (!this.agents.has(name)) return [404, { error: { code: "not_found", message: "Agent not found." } }];
    if (rest[0] === "versions") return [200, this.version(name)];
    return [200, { object: "agent", id: name, name, versions: { latest: this.version(name) } }];
  }

  deploymentChecks() {
    return this.requests.filter((r) => r.url.includes("/deployments/")).map((r) => new URL(r.url).pathname.split("/").pop());
  }
}

let eventCount = 0;
const event = (type, fields) => ({ type, event_id: `event-${++eventCount}`, ...fields });
const SESSION = { id: "live_offline", audio: { format: { type: "audio/pcm", rate: 24000 } } };
const audible = Buffer.alloc(480);
for (let offset = 0; offset < audible.length; offset += 2) audible.writeInt16LE(4000, offset);

const live = {
  started: (conversationId) => event("session.started", { session: SESSION, conversation_id: conversationId }),
  user: (delta) => event("session.input_transcript.delta", { delta, start_ms: 0, end_ms: 100 }),
  teacher: (delta) => event("session.output_transcript.delta", { delta, start_ms: 100, end_ms: 200 }),
  audio: (pcm) => ({ type: "session.output_audio.delta", delta: pcm.toString("base64") }),
  delegation: (id, target) =>
    event("session.delegation.created", { delegation: { id, type: "delegation", target }, offset_ms: 1000 }),
  backend: (id, type, fields = {}) => event("response.event", { delegation_id: id, event: { type, ...fields } }),
  commentary: () => event("session.commentary.appended", { start_ms: 200, end_ms: 400 }),
  closed: (reason) => event("session.closed", { session: SESSION, reason, usage: { seconds: 1 } }),
};

/**
 * A scripted Live endpoint for the SDK's WebSocket factory: sends session.started after the
 * upgrade and the remaining events shortly after the client is ready, records client commands,
 * and answers session.close with session.closed.
 */
class ScriptedLive {
  constructor(events = []) {
    this.events = events;
    this.connects = [];
    this.received = [];
  }

  create() {
    let handlers;
    let closed = false;
    const finish = (code) => {
      if (closed) return;
      closed = true;
      setImmediate(() => handlers.onClose(code, "", true));
    };
    const emit = (payload) => handlers.onMessage(JSON.stringify(payload));
    return {
      setHandlers: (value) => {
        handlers = value;
      },
      connect: async (options) => {
        this.connects.push(options);
        const play = (payloads) => {
          for (const payload of payloads) {
            if (closed) return;
            emit(payload);
            if (payload.type === "session.closed") finish(1000);
          }
        };
        const [first, ...rest] = this.events;
        setImmediate(() => play(first ? [first] : []));
        setTimeout(() => play(rest), 20);
      },
      send: async (data) => {
        const command = JSON.parse(data);
        this.received.push(command);
        if (command.type === "session.close" && !closed) {
          emit(live.closed("close_requested"));
          finish(1000);
        }
      },
      close: async (code) => finish(code),
    };
  }

  commands() {
    return this.received.map((command) => command.type);
  }
}

let folder;
let question;
before(async () => {
  folder = await mkdtemp(join(tmpdir(), "gpt-live-js-"));
  question = join(folder, "question.wav");
  await writePcmWav(question, Buffer.concat([audible, audible]));
});
after(async () => rm(folder, { recursive: true, force: true }));

async function run(sample, { argv = [], env = {}, project = new OfflineProject(), events } = {}) {
  const liveEndpoint = new ScriptedLive(events);
  let output = "";
  const context = { project, live: liveEndpoint, output: () => output };
  context.result = sample.main({
    // Without a scripted session, the managed sample runs --create-only and needs no recording.
    argv: events === undefined && sample === managed ? argv : ["--input", question, ...argv],
    env: {
      FOUNDRY_PROJECT_ENDPOINT: ENDPOINT,
      GPT_LIVE_DEPLOYMENT: "live-model",
      RESPONSE_DELEGATION_DEPLOYMENT: "text-model",
      ...env,
    },
    credential,
    clientOptions: { httpClient: project, liveOptions: { webSocketFactory: liveEndpoint } },
    timing: TIMING,
    write: (text) => {
      output += text;
    },
  });
  return context;
}

function assertHandshake(liveEndpoint, agentName, version) {
  assert.equal(liveEndpoint.connects.length, 1);
  const { url, headers: sent } = liveEndpoint.connects[0];
  const parsed = new URL(url);
  assert.equal(parsed.protocol, "wss:");
  assert.equal(
    parsed.pathname,
    `/api/projects/test/agents/${agentName}/endpoint/protocols/voice/live/sessions`,
  );
  assert.equal(parsed.searchParams.get("x-agent-version-override"), version);
  assert.equal(sent.authorization, "Bearer offline-test-token");
  assert.equal(sent["foundry-features"], "VoiceAgents=V1Preview");
}

describe("payloads", () => {
  it("defines a Responses-delegation GPT Live agent", () => {
    const definition = direct.agentDefinition({ GPT_LIVE_DEPLOYMENT: "live", RESPONSE_DELEGATION_DEPLOYMENT: "text" });
    assert.deepEqual(
      [definition.kind, definition.sub_protocol, definition.model_type, definition.model, definition.store],
      ["voice", "live", "self_deployed", "live", true],
    );
    assert.deepEqual(definition.delegation, {
      type: "responses",
      responses: { model: "text", instructions: direct.BACKEND_INSTRUCTIONS },
    });
    assert.deepEqual(definition.audio, { format: { type: "audio/pcm", rate: 24000 }, output: { voice: "marin" } });
  });

  it("pins the managed prompt agent version with plain-text output", () => {
    const voice = managed.voiceAgentDefinition("live", "prompt", 7);
    assert.deepEqual(voice.delegation, { type: "foundry_managed_agent", agent_name: "prompt", agent_version: "7" });
    assert.equal(voice.store, true);
    const prompt = managed.promptAgentDefinition("text");
    assert.deepEqual(prompt.text, { format: { type: "text" } });
    assert.match(prompt.instructions, /\[commentary\]/);
    assert.equal(prompt.tools, undefined);
  });
});

describe("WAV audio", () => {
  it("round-trips PCM16 mono 24 kHz", async () => {
    const path = join(folder, "round-trip.wav");
    await writePcmWav(path, audible);
    assert.deepEqual(await readPcmWav(path), audible);
  });

  it("rejects other formats", async () => {
    const path = join(folder, "16k.wav");
    await writePcmWav(path, audible);
    const wav = await readFile(path);
    wav.writeUInt32LE(16000, 24);
    await writeFile(path, wav);
    await assert.rejects(readPcmWav(path), DemoError);
  });
});

describe("response_delegation", () => {
  it("creates a Live agent, streams the question, shows backend guidance, and deletes it", async () => {
    const output = join(folder, "reply.wav");
    const context = await run(direct, {
      argv: ["--output", output, "--auto-delete"],
      events: [
        live.started("conversation-direct"),
        live.user("I goed to school."),
        live.delegation("delegation-1", "responses"),
        live.backend("delegation-1", "response.created"),
        live.backend("delegation-1", "response.output_text.delta", { delta: "Say: I went." }),
        live.backend("delegation-1", "response.completed"),
        live.teacher("I went to school."),
        live.audio(audible),
      ],
    });
    const result = await context.result;
    const { project, live: liveEndpoint } = context;
    const [agent] = project.created;
    assert.equal(project.created.length, 1);
    assert.equal(agent.features, "VoiceAgents=V1Preview");
    assert.deepEqual(agent.definition.delegation.responses.model, "text-model");
    assert.deepEqual(project.deploymentChecks(), ["live-model", "text-model"]);
    assert.equal(project.requests[0].method, "GET");
    assertHandshake(liveEndpoint, agent.name, "3");
    // The sample passes raw PCM chunks; the SDK sends them base64-encoded.
    const sent = Buffer.concat(
      liveEndpoint.received
        .filter((c) => c.type === "session.input_audio.append")
        .map((c) => Buffer.from(c.audio, "base64")),
    );
    assert.deepEqual(sent.subarray(0, audible.length * 2), Buffer.concat([audible, audible]));
    assert.equal(liveEndpoint.commands().at(-1), "session.close");
    assert.equal(result.conversationId, "conversation-direct");
    assert.equal(result.closeReason, "close_requested");
    assert.match(context.output(), /You: I goed to school\./);
    assert.match(context.output(), /Teacher: I went to school\./);
    assert.match(context.output(), /\[delegation-1\] Backend guidance: Say: I went\./);
    assert.match(context.output(), /Conversation id: conversation-direct/);
    assert.deepEqual(await readPcmWav(output), audible);
    assert.deepEqual(project.deleted, [agent.name]);
  });

  it("reuses AGENT_NAME without creating, updating, or deleting it", async () => {
    const saved = {
      kind: "voice", sub_protocol: "live", model_type: "self_deployed", model: "saved-live",
      delegation: { type: "responses", responses: { model: "saved-text" } },
    };
    const context = await run(direct, {
      argv: ["--auto-delete"],
      env: { AGENT_NAME: "teacher" },
      project: new OfflineProject({ teacher: { version: "5", definition: saved } }),
      events: [live.started("conversation-existing")],
    });
    await context.result;
    assert.deepEqual(context.project.created, []);
    assert.deepEqual(context.project.deleted, []);
    assert.deepEqual(context.project.deploymentChecks(), ["saved-live", "saved-text"]);
    assertHandshake(context.live, "teacher", "5");
    assert.match(context.output(), /python ".*download_conversation_artifacts\.py" "teacher" "conversation-existing"/);
  });

  it("rejects a missing or Realtime agent before opening Live", async () => {
    const realtime = { kind: "voice", model: "realtime-model" };
    for (const [agents, message] of [[{}, /was not found/], [{ teacher: { version: "1", definition: realtime } }, /sub_protocol=live/]]) {
      const context = await run(direct, {
        env: { AGENT_NAME: "teacher" },
        project: new OfflineProject(agents),
        events: [],
      });
      await assert.rejects(context.result, message);
      assert.deepEqual(context.live.connects, []);
      assert.deepEqual(context.project.deleted, []);
    }
  });

  it("answers a client delegation with commentary tied to its ID", async () => {
    const context = await run(direct, {
      argv: ["--auto-delete"],
      events: [live.started("conversation-client"), live.delegation("delegation-client", "client")],
    });
    await context.result;
    const commentary = context.live.received.filter((c) => c.type === "session.commentary.append");
    assert.equal(commentary.length, 1);
    assert.equal(commentary[0].delegation_id, "delegation-client");
  });

  it("fails on a Responses backend failure or a lost connection", async () => {
    for (const [events, message] of [
      [[live.started("c"), live.delegation("d", "responses"), live.backend("d", "response.failed")], /response\.failed/],
      [[live.started("c"), live.closed("connection_lost")], /connection was lost/],
    ]) {
      const context = await run(direct, { argv: ["--auto-delete"], events });
      await assert.rejects(context.result, message);
      assert.equal(context.project.deleted.length, 1);
    }
  });
});

describe("prompt_agent_delegation", () => {
  it("--create-only keeps both agents and pins the returned prompt version", async () => {
    const context = await run(managed, { argv: ["--create-only"] });
    await context.result;
    const { project, live: liveEndpoint } = context;
    const [prompt, voice] = project.created;
    assert.equal(prompt.definition.kind, "prompt");
    assert.deepEqual(voice.definition.delegation, {
      type: "foundry_managed_agent", agent_name: prompt.name, agent_version: "7",
    });
    assert.equal(voice.features, "VoiceAgents=V1Preview");
    assert.deepEqual(project.deploymentChecks(), ["live-model", "text-model"]);
    assert.deepEqual(project.requests.slice(0, 2).map((r) => r.method), ["GET", "GET"]);
    assert.deepEqual(liveEndpoint.connects, []);
    assert.deepEqual(project.deleted, []);
    assert.match(context.output(), /Kept agent: .*live.*\n.*Kept agent: .*prompt/s);
  });

  it("shows managed delegation without raw backend text, then deletes voice before prompt", async () => {
    const context = await run(managed, {
      argv: ["--auto-delete"],
      events: [
        live.started("conversation-managed"),
        live.delegation("delegation-managed", "foundry_managed_agent"),
        live.backend("delegation-managed", "response.created"),
        live.backend("delegation-managed", "response.output_text.delta", { delta: "[commentary] RAW_BACKEND_TEXT" }),
        live.commentary(),
        live.backend("delegation-managed", "response.completed"),
        live.teacher("I went to school yesterday."),
      ],
    });
    const result = await context.result;
    const { project, live: liveEndpoint } = context;
    const [prompt, voice] = project.created;
    assertHandshake(liveEndpoint, voice.name, "3");
    assert.equal(result.conversationId, "conversation-managed");
    assert.match(context.output(), /Managed delegation → .*: prompt agent delegation requested/);
    assert.match(context.output(), /Backend response completed/);
    assert.match(context.output(), /Foundry forwarded accepted commentary to GPT Live/);
    assert.doesNotMatch(context.output(), /RAW_BACKEND_TEXT/);
    // The client only streams audio and closes; Foundry runs the prompt agent.
    assert.deepEqual([...new Set(liveEndpoint.commands())], ["session.input_audio.append", "session.close"]);
    assert.deepEqual(project.deleted, [voice.name, prompt.name]);
  });

  it("rejects native client or responses targets without a fallback", async () => {
    for (const target of ["client", "responses"]) {
      const context = await run(managed, {
        argv: ["--auto-delete"],
        events: [live.started("c"), live.delegation("d", target)],
      });
      await assert.rejects(context.result, new RegExp(`delegation target '${target}'`));
      assert.ok(!context.live.commands().some((type) => /commentary|thinking|response\./.test(type)));
      assert.equal(context.project.deleted.length, 2);
    }
  });

  it("cleans up only the prompt agent when voice-agent creation fails", async () => {
    const context = await run(managed, {
      argv: ["--create-only"],
      project: new OfflineProject({}, { failVoice: true }),
    });
    await assert.rejects(context.result, /HTTP 400/);
    assert.equal(context.project.created.length, 1);
    assert.deepEqual(context.project.deleted, []);
    const auto = await run(managed, {
      argv: ["--auto-delete"],
      project: new OfflineProject({}, { failVoice: true }),
      events: [],
    });
    await assert.rejects(auto.result, /HTTP 400/);
    assert.deepEqual(auto.project.deleted, [auto.project.created[0].name]);
  });
});
