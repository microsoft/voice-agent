// Shared settings, Projects SDK client, WAV audio, and the GPT Live event loop for the samples.
import { AIProjectClient, isRestError } from "@azure/ai-projects";
import { AzureCliCredential } from "@azure/identity";
import { config } from "dotenv";
import { realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** PCM16 mono sample rate used in both directions. */
export const RATE = 24000;
/** GPT Live agent definitions are a preview; create calls must opt in. */
export const PREVIEW = { foundryFeatures: "VoiceAgents=V1Preview" };

export const ENGLISH_TEACHER_INSTRUCTIONS =
  "You are a patient English teacher helping the learner practice spoken English. " +
  "Ask one short question at a time and let the learner answer. Gently correct " +
  "grammar or vocabulary mistakes with an improved sentence and a brief explanation. " +
  "Keep replies concise and encouraging. Use English for practice; if the learner " +
  "asks in Chinese, briefly explain in Chinese and then return to English.";

/** Default pacing: real-time 100 ms chunks, then wait until the reply has been quiet for 5 s. */
export const DEFAULT_TIMING = { chunkMs: 100, idleMs: 5000, maxMs: 120_000 };
/** Live keeps streaming output audio between replies; PCM at or below this peak counts as silence. */
const SILENCE_PEAK = 256;

function isAudible(pcm) {
  for (let offset = 0; offset + 1 < pcm.length; offset += 2) {
    if (Math.abs(pcm.readInt16LE(offset)) > SILENCE_PEAK) return true;
  }
  return false;
}

export class DemoError extends Error {}

export function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new DemoError(`Set ${name} in .env or the process environment.`);
  return value;
}

/** Validates an existing project endpoint: https://RESOURCE.services.ai.azure.com/api/projects/PROJECT. */
export function projectEndpoint(env) {
  const value = env.FOUNDRY_PROJECT_ENDPOINT?.trim();
  if (!value) {
    throw new DemoError(
      "Set FOUNDRY_PROJECT_ENDPOINT=https://YOUR-RESOURCE.services.ai.azure.com/api/projects/YOUR-PROJECT " +
        "in .env. This creates a voice agent in an EXISTING project, not a new Azure project.",
    );
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    url = undefined;
  }
  const path = url?.pathname.replace(/\/+$/, "") ?? "";
  const project = path.startsWith("/api/projects/") ? path.slice("/api/projects/".length) : "";
  if (
    !url ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !project ||
    project.includes("/")
  ) {
    throw new DemoError(
      "Use an HTTPS project endpoint ending in /api/projects/YOUR-PROJECT without credentials/query/fragment.",
    );
  }
  return `${url.origin}${path}`;
}

/** Your az login account; AZURE_SUBSCRIPTION_ID picks a signed-in subscription without changing the CLI default. */
export function projectCredential(env) {
  return new AzureCliCredential({ subscription: env.AZURE_SUBSCRIPTION_ID?.trim() || undefined });
}

/** One client manages agents over REST and opens Live WebSocket sessions with the same credential. */
export function createProject(endpoint, credential, clientOptions) {
  return new AIProjectClient(endpoint, credential, clientOptions);
}

export function liveAudio() {
  return { format: { type: "audio/pcm", rate: RATE }, output: { voice: "marin" } };
}

/** Runs a Projects SDK call, turning HTTP errors into short hints. */
export async function serviceCall(action, operation, { notFound } = {}) {
  try {
    return await operation();
  } catch (error) {
    if (!isRestError(error) || error.statusCode === undefined) throw error;
    if (error.statusCode === 404 && notFound) throw new DemoError(notFound, { cause: error });
    const hint =
      {
        401: "Run az login again and check AZURE_SUBSCRIPTION_ID.",
        403: "Check the signed-in identity's project permissions and preview access.",
        404: "Check the project endpoint and whether this service has the Live implementation.",
        409: "The generated agent name already exists; run the demo again.",
        429: "Deployment quota is exhausted; retry later.",
      }[error.statusCode] ?? "Check the request and service configuration.";
    throw new DemoError(`${action}: HTTP ${error.statusCode}. ${hint}`, { cause: error });
  }
}

/** Checks model deployments by name with read-only requests; the samples never create deployments. */
export async function checkDeployments(project, deployments, display) {
  for (const [setting, name] of Object.entries(deployments)) {
    const deployment = await serviceCall(`Check deployment '${name}'`, () => project.deployments.get(name), {
      notFound:
        `Deployment '${name}' was not found in this project. ` +
        `Check the existing agent's deployment, or ${setting} for a new agent.`,
    });
    if (deployment.name !== name) {
      throw new DemoError(`Deployment readback did not match ${setting}='${name}'.`);
    }
    display.status(`Deployment verified: ${setting}=${name}`);
  }
}

/** Reads raw PCM from a PCM16, mono, 24 kHz WAV recording. */
export async function readPcmWav(path) {
  const wav = await readFile(path);
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new DemoError(`${path} is not a WAV file.`);
  }
  let format;
  for (let offset = 12; offset + 8 <= wav.length; ) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      format = {
        encoding: wav.readUInt16LE(offset + 8),
        channels: wav.readUInt16LE(offset + 10),
        rate: wav.readUInt32LE(offset + 12),
        bits: wav.readUInt16LE(offset + 22),
      };
    } else if (id === "data") {
      if (format?.encoding !== 1 || format.channels !== 1 || format.rate !== RATE || format.bits !== 16) {
        throw new DemoError(`${path} must be uncompressed PCM16, mono, ${RATE} Hz.`);
      }
      const pcm = wav.subarray(offset + 8, offset + 8 + size);
      if (!pcm.length || pcm.length % 2) throw new DemoError(`${path} has no complete PCM16 audio.`);
      return pcm;
    }
    offset += 8 + size + (size % 2);
  }
  throw new DemoError(`${path} has no audio data.`);
}

/** Writes PCM16, mono, 24 kHz audio as a WAV file. */
export async function writePcmWav(path, pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  await writeFile(path, Buffer.concat([header, pcm]));
}

/** Console transcript: "You" and "Teacher" lines, with delegation status on their own lines. */
export class Display {
  constructor(write = (text) => process.stdout.write(text)) {
    this.write = write;
    this.role = undefined;
  }

  speech(role, delta) {
    if (this.role !== role) {
      this.write(`${this.role ? "\n" : ""}${role}: `);
      this.role = role;
    }
    this.write(delta);
  }

  status(line) {
    this.write(`${this.role ? "\n" : ""}${line}\n`);
    this.role = undefined;
  }
}

const BACKEND_STATUSES = {
  "response.created": "Backend response started",
  "response.in_progress": "Backend response in progress",
  "response.completed": "Backend response completed",
  "response.failed": "Backend response failed",
  "response.incomplete": "Backend response incomplete",
  error: "Backend error",
};
const BACKEND_FAILURES = new Set(["error", "response.failed", "response.incomplete"]);

/**
 * The whole SDK event/audio loop is here so each sample can be read on its own.
 *
 * Streams a recorded question in real time, then silence until any delegated work has
 * finished and the reply has been quiet for timing.idleMs (or Ctrl+C). Live has no
 * reply-finished event, so this is a heuristic: a long pause can end it early. Closes the session
 * gracefully and returns its conversation ID, close reason, and the reply audio.
 */
export async function converse(
  connection,
  { input, backendModel, managedDelegation = false, display, timing = DEFAULT_TIMING, stop = new AbortController() },
) {
  const chunkBytes = (RATE * 2 * timing.chunkMs) / 1000;
  const output = [];
  const pending = new Set();
  const backendText = new Map();
  const replied = new Set();
  let conversationId;
  let closeReason;
  let lastActivity = Date.now();

  async function observe(event) {
    switch (event.type) {
      case "session.started": {
        // Foundry adds conversation_id at the top level; it is not session.id.
        conversationId = event.conversation_id || undefined;
        const format = event.session?.audio?.format;
        if (format && (format.type !== "audio/pcm" || format.rate !== RATE)) {
          throw new DemoError("The negotiated format is not the requested PCM16/24 kHz.");
        }
        display.status(`Ready: ${event.session.id}. Streaming the question; Ctrl+C ends the English lesson.`);
        break;
      }
      case "error":
      case "transport.failed":
        throw new DemoError(`Live error: ${event.error?.message ?? event.type}`);
      case "session.output_audio.delta": {
        const pcm = Buffer.from(event.delta, "base64");
        output.push(pcm);
        if (isAudible(pcm)) lastActivity = Date.now();
        break;
      }
      case "session.input_transcript.delta":
        display.speech("You", event.delta);
        break;
      case "session.output_transcript.delta":
        display.speech("Teacher", event.delta);
        lastActivity = Date.now();
        break;
      case "session.delegation.created": {
        const { id, target } = event.delegation;
        if (managedDelegation) {
          // Managed sessions keep the native event, but Foundry reports itself as the
          // owner: the client must not execute the prompt agent or send commentary.
          if (target !== "foundry_managed_agent") {
            throw new DemoError(
              `Expected Foundry-managed delegation, but received delegation target '${target}'. ` +
                "Check that the service supports foundry_managed_agent; no client fallback was run.",
            );
          }
          pending.add(id);
          display.status(`[${id}] Managed delegation → ${backendModel}: prompt agent delegation requested`);
          break;
        }
        display.status(`[${id}] Delegation → ${target === "responses" ? backendModel : target}: requested`);
        if (target === "responses") {
          pending.add(id);
        } else if (target === "client" && !replied.has(id)) {
          replied.add(id);
          await connection.appendCommentary(
            "This demo uses a Responses backend, not a client executor. Please continue the English lesson.",
            { delegationId: id },
          );
        }
        break;
      }
      case "response.event": {
        // Backend events, correlated to their delegation. Not the spoken teacher transcript.
        const backend = event.event ?? {};
        const id = event.delegation_id ?? "uncorrelated-backend";
        lastActivity = Date.now();
        if (backend.type === "response.output_text.delta" && !managedDelegation) {
          backendText.set(id, (backendText.get(id) ?? "") + backend.delta);
        }
        if (!(backend.type in BACKEND_STATUSES)) break;
        display.status(`[${id}] ${BACKEND_STATUSES[backend.type]}`);
        if (backend.type === "response.completed" && backendText.has(id)) {
          display.status(`[${id}] Backend guidance: ${backendText.get(id)}`);
          backendText.delete(id);
        }
        if (backend.type === "response.completed" || BACKEND_FAILURES.has(backend.type)) pending.delete(id);
        if (BACKEND_FAILURES.has(backend.type) && !managedDelegation) {
          throw new DemoError(
            `Teaching backend reported ${backend.type}; check its deployment and configuration.`,
          );
        }
        // Managed failures stay visible: Foundry owns any fallback, and the client does not retry.
        break;
      }
      case "session.commentary.appended":
      case "session.thinking.appended":
        if (managedDelegation) {
          // Foundry validated the prompt agent's tagged text and forwarded it to GPT Live.
          // Raw backend text is not displayed: only accepted guidance reaches the teacher.
          const kind = event.type === "session.commentary.appended" ? "commentary" : "thinking";
          display.status(`Foundry forwarded accepted ${kind} to GPT Live`);
          lastActivity = Date.now();
        }
        break;
      case "session.closed":
        closeReason = event.reason;
        display.status(
          `Session closed: ${event.reason}; cumulative Live usage: ${event.usage?.seconds} seconds`,
        );
        if (event.reason === "connection_lost") {
          throw new DemoError("Upstream connection was lost; native finalization is not confirmed.");
        }
        break;
    }
  }

  let receiveError;
  const receiver = (async () => {
    try {
      for await (const event of connection) await observe(event);
    } catch (error) {
      receiveError = error;
      stop.abort();
    }
  })();

  const onInterrupt = () => stop.abort();
  process.once("SIGINT", onInterrupt);
  let sendError;
  try {
    const silence = new Uint8Array(chunkBytes);
    const deadline = Date.now() + timing.maxMs;
    for (let offset = 0; !stop.signal.aborted && closeReason === undefined; offset += chunkBytes) {
      const inputDone = offset >= input.length;
      if (inputDone && !pending.size && Date.now() - lastActivity >= timing.idleMs) break;
      if (Date.now() >= deadline) {
        display.status("Reached the time limit; closing the session.");
        break;
      }
      // Live has no end-of-input command: keep the audio timeline moving with silence.
      await connection.sendAudio(inputDone ? silence : input.subarray(offset, offset + chunkBytes));
      if (!inputDone) lastActivity = Date.now();
      await sleep(timing.chunkMs);
    }
  } catch (error) {
    // A failed receive also stops sending; report the receive error, not the send that lost the race.
    sendError = error;
  } finally {
    process.off("SIGINT", onInterrupt);
  }
  if (closeReason === undefined) {
    if (!receiveError && !sendError) display.status("Closing; waiting for session.closed...");
    // Sends session.close, waits for session.closed, then closes the socket.
    await connection.close().catch((error) => {
      sendError ??= error;
    });
  }
  await receiver;
  if (receiveError ?? sendError) throw receiveError ?? sendError;
  return { conversationId, closeReason, outputAudio: Buffer.concat(output) };
}

/** Prints how to download the persisted conversation with the repository's shared downloader. */
export function printDownloadCommand(display, endpoint, agentName, conversationId) {
  const downloader = fileURLToPath(new URL("../download_conversation_artifacts.py", import.meta.url));
  display.status(
    "Download it later with the shared Python downloader (run from the repository root):\n" +
      `Set AZURE_VOICE_AGENTS_ENDPOINT to ${endpoint}.\n` +
      `python "${downloader}" "${agentName}" "${conversationId}"`,
  );
}

/** Parses the shared command line; --input is required unless --create-only is supported and set. */
export function parseCli(argv, { createOnly = false } = {}) {
  const options = {
    input: { type: "string" },
    output: { type: "string" },
    "auto-delete": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  };
  if (createOnly) options["create-only"] = { type: "boolean", default: false };
  const { values } = parseArgs({ args: argv, options, strict: true, allowPositionals: false });
  if (values["create-only"] && values["auto-delete"]) {
    throw new DemoError("--create-only and --auto-delete cannot be used together.");
  }
  if (!values.help && !values["create-only"] && !values.input) {
    throw new DemoError("Pass --input question.wav (PCM16, mono, 24 kHz). See the README to record one.");
  }
  return {
    input: values.input,
    output: values.output,
    autoDelete: values["auto-delete"],
    createOnly: Boolean(values["create-only"]),
    help: values.help,
  };
}

/** Runs a sample's main from the command line with readable errors and exit codes. */
export async function runCli(moduleUrl, main, usage) {
  const entry = process.argv[1] && realpathSync(process.argv[1]);
  if (entry !== realpathSync(fileURLToPath(moduleUrl))) return;
  config({ path: fileURLToPath(new URL(".env", moduleUrl)), quiet: true });
  try {
    await main({ argv: process.argv.slice(2), env: process.env, usage });
  } catch (error) {
    const name = error?.name ?? "";
    if (error instanceof DemoError || error?.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
      console.error(`\nError: ${error.message}`);
    } else if (
      ["CredentialUnavailableError", "AuthenticationError", "VoiceAgentAuthenticationError"].includes(name)
    ) {
      console.error(
        "\nAzure CLI authentication failed. Run az login with an account that " +
          "can access this project, and check AZURE_SUBSCRIPTION_ID in .env.",
      );
    } else {
      const status = error?.statusCode ? ` (HTTP ${error.statusCode})` : "";
      console.error(`\n${name || "Error"}${status}: ${error?.message ?? error}`);
    }
    process.exitCode = 1;
  }
}
