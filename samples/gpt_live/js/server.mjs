#!/usr/bin/env node
// Browser GPT Live English teacher. The Node server creates or reuses the agents with the
// Azure AI Projects SDK, serves the page, and relays microphone audio from the browser to a
// GPT Live session. Credentials stay on the server; the browser never receives a token.
import { config } from "dotenv";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { WebSocketServer } from "ws";

import {
  DemoError,
  createProject,
  deleteAgents,
  prepareManagedAgents,
  prepareResponsesAgent,
  projectCredential,
  projectEndpoint,
} from "./agents.mjs";
import { relaySession } from "./live_relay.mjs";

const USAGE = `Usage: node server.mjs [--managed] [--auto-delete] [--port 8080]

  (default)      Create an English-teacher GPT Live agent with Responses delegation,
                 or reuse AGENT_NAME from samples/gpt_live/.env.
  --managed      Create a prompt agent and a GPT Live agent pinned to it (Foundry-managed
                 delegation). Ignores AGENT_NAME.
  --auto-delete  Delete only the agents created by this run when the server stops.
  --port         Local port (default 8080). The server listens on 127.0.0.1 only.`;

// Only these files are served; nothing else in the sample folder is reachable.
const PUBLIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/pcm-audio.js": ["pcm-audio.js", "text/javascript; charset=utf-8"],
  "/pcm-capture.js": ["pcm-capture.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
};
const PUBLIC_DIR = new URL("./public/", import.meta.url);
const DOWNLOADER = fileURLToPath(new URL("../../download_conversation_artifacts.py", import.meta.url));

/** The command for the shared Python downloader, run from the repository root. */
export function downloadCommand(endpoint, agentName, conversationId) {
  return (
    `Set AZURE_VOICE_AGENTS_ENDPOINT to ${endpoint}, then run from the repository root:\n` +
    `python "${DOWNLOADER}" "${agentName}" "${conversationId}"`
  );
}

/** Serves the page and relays /live WebSocket sessions to `agent`. Call listen(port) to start. */
export function createServer({ project, agent, endpoint, keepAgent = true, log = () => {} }) {
  const sessions = new Set();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
  const server = http.createServer(async (request, response) => {
    const { pathname } = new URL(request.url, "http://localhost");
    if (request.method === "GET" && pathname === "/config") {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(
        JSON.stringify({
          agent: agent.name,
          version: agent.version,
          delegation: agent.managedDelegation ? "Foundry-managed prompt agent" : "Responses",
          backend: agent.backendModel,
        }),
      );
      return;
    }
    const file = request.method === "GET" ? PUBLIC[pathname] : undefined;
    if (!file) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("Not found");
      return;
    }
    const body = await readFile(new URL(file[0], PUBLIC_DIR));
    response.writeHead(200, { "content-type": file[1], "cache-control": "no-store" });
    response.end(body);
  });

  server.on("upgrade", (request, socket, head) => {
    const { pathname } = new URL(request.url, "http://localhost");
    // Only this page may use your Azure credential: reject other origins, including other
    // local sites, before upgrading.
    const { port } = server.address();
    const allowed = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
    if (pathname !== "/live" || !allowed.includes(request.headers.origin)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(request, socket, head, (browser) => {
      log("Browser connected; starting a GPT Live session.");
      const session = relaySession(browser, { project, agent, log }).then((result) => {
        if (result.conversationId) {
          log(`Conversation id: ${result.conversationId}`);
          if (keepAgent) log(downloadCommand(endpoint, agent.name, result.conversationId));
        }
        if (result.closeReason) log(`Session closed: ${result.closeReason}; Live usage ${result.usageSeconds} seconds`);
        return result;
      });
      sessions.add(session);
      session.finally(() => sessions.delete(session));
    });
  });

  return {
    server,
    sessions,
    listen: (port = 0) =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => resolve(server.address().port));
      }),
    async close() {
      for (const browser of wss.clients) browser.close(1001, "Server stopping.");
      await Promise.allSettled([...sessions]);
      wss.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * Prepares the agents and starts the server. Tests pass credential and clientOptions (an
 * offline HTTP client and Live WebSocket factory); the command line uses az login.
 * Resolves with { port, agent, stop }, where stop() closes sessions and cleans up agents.
 */
export async function main({ argv = [], env = process.env, credential, clientOptions, log = console.log } = {}) {
  const { values } = parseArgs({
    args: argv,
    options: {
      managed: { type: "boolean", default: false },
      "auto-delete": { type: "boolean", default: false },
      port: { type: "string", default: "8080" },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (values.help) {
    log(USAGE);
    return undefined;
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new DemoError("--port must be 0-65535.");
  const autoDelete = values["auto-delete"];
  const endpoint = projectEndpoint(env);
  const project = createProject(endpoint, credential ?? projectCredential(env), clientOptions);
  const created = [];
  const cleanup = async () => {
    if (autoDelete) await deleteAgents(project, created, log);
    else for (const name of [...created].reverse()) log(`Kept agent: ${name}. Delete it in your Foundry project when finished.`);
  };

  let agent;
  try {
    agent = values.managed
      ? await prepareManagedAgents(project, env, log, created)
      : await prepareResponsesAgent(project, env, log, created);
  } catch (error) {
    await cleanup();
    throw error;
  }
  const app = createServer({ project, agent, endpoint, keepAgent: !autoDelete || !created.includes(agent.name), log });
  let listening;
  try {
    listening = await app.listen(port);
  } catch (error) {
    await cleanup();
    throw error;
  }
  log(`\nOpen http://localhost:${listening} in Chrome or Edge, click Start, and speak. Press Ctrl+C to stop.`);
  return {
    port: listening,
    agent,
    async stop() {
      await app.close();
      await cleanup();
    },
  };
}

async function runCli() {
  config({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });
  try {
    const running = await main({ argv: process.argv.slice(2), env: process.env });
    if (!running) return;
    process.once("SIGINT", async () => {
      console.log("\nStopping...");
      await running.stop();
    });
  } catch (error) {
    if (error instanceof DemoError || error?.code?.startsWith?.("ERR_PARSE_ARGS")) {
      console.error(`\nError: ${error.message}`);
    } else if (["CredentialUnavailableError", "AuthenticationError"].includes(error?.name)) {
      console.error(
        "\nAzure CLI authentication failed. Run az login with an account that " +
          "can access this project, and check AZURE_SUBSCRIPTION_ID in .env.",
      );
    } else {
      const status = error?.statusCode ? ` (HTTP ${error.statusCode})` : "";
      console.error(`\n${error?.name ?? "Error"}${status}: ${error?.message ?? error}`);
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  await runCli();
}
