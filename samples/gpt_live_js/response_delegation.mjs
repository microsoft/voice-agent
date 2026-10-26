#!/usr/bin/env node
// Create or reuse a Foundry GPT Live agent with Responses delegation, stream a recorded
// question through the Azure AI Projects SDK Live client, and print the conversation ID.
import { randomUUID } from "node:crypto";

import {
  DemoError,
  Display,
  DEFAULT_TIMING,
  ENGLISH_TEACHER_INSTRUCTIONS,
  PREVIEW,
  checkDeployments,
  converse,
  createProject,
  liveAudio,
  parseCli,
  printDownloadCommand,
  projectCredential,
  projectEndpoint,
  readPcmWav,
  required,
  runCli,
  serviceCall,
  writePcmWav,
} from "./live_common.mjs";

export const BACKEND_INSTRUCTIONS =
  "You are an expert English teacher supporting a spoken English lesson. " +
  "Give one accurate, concise grammar explanation and one example or corrected sentence. " +
  "Write guidance for the voice teacher, not a long essay.";

const USAGE = `Usage: node response_delegation.mjs --input question.wav [--output reply.wav] [--auto-delete]

  --input        Spoken question: PCM16, mono, 24 kHz WAV, streamed in real time.
  --output       Save the teacher's spoken reply as a WAV file.
  --auto-delete  Delete only the agent created by this run on exit (default: keep it).

Set AGENT_NAME in .env to reuse an existing GPT Live agent instead of creating one.`;

// Agent configuration is intentionally fully visible here, separate from the Live conversation.
export function agentDefinition(env) {
  return {
    kind: "voice",
    sub_protocol: "live",
    model_type: "self_deployed",
    model: required(env, "GPT_LIVE_DEPLOYMENT"),
    instructions:
      ENGLISH_TEACHER_INSTRUCTIONS +
      " Handle greetings and casual conversation yourself. For grammar corrections, " +
      "grammar explanations, or lesson planning, always delegate to the Responses " +
      "English-teacher backend first, then explain its guidance aloud.",
    audio: liveAudio(),
    delegation: {
      type: "responses",
      responses: { model: required(env, "RESPONSE_DELEGATION_DEPLOYMENT"), instructions: BACKEND_INSTRUCTIONS },
    },
    // Persist in Foundry for the shared conversation downloader.
    store: true,
  };
}

/** Deployments named by a GPT Live definition: the Live model and any Responses backend. */
export function definitionDeployments(definition) {
  const deployments = { GPT_LIVE_DEPLOYMENT: definition.model };
  if (definition.delegation?.type === "responses") {
    deployments.RESPONSE_DELEGATION_DEPLOYMENT = definition.delegation.responses.model;
  }
  return deployments;
}

/**
 * Runs the sample. Tests pass credential and clientOptions (an offline HTTP client and Live
 * WebSocket factory) plus shorter timing; the command line uses az login and real time.
 */
export async function main({
  argv = [],
  env = process.env,
  credential,
  clientOptions,
  timing = DEFAULT_TIMING,
  write,
  usage = USAGE,
} = {}) {
  const args = parseCli(argv);
  const display = new Display(write);
  if (args.help) return display.status(usage);
  const base = projectEndpoint(env);
  const existingAgent = env.AGENT_NAME?.trim();
  const name = existingAgent || `english-teacher-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let definition = existingAgent ? undefined : agentDefinition(env);
  // Check the recording before any service writes.
  const input = await readPcmWav(args.input);
  const project = createProject(base, credential ?? projectCredential(env), clientOptions);
  if (definition) await checkDeployments(project, definitionDeployments(definition), display);

  let created = false;
  try {
    let version;
    if (!existingAgent) {
      const agent = await serviceCall("Create agent", () => project.agents.create(name, definition, PREVIEW));
      created = true;
      version = agent.versions.latest.version;
      display.status(`Created English teacher agent: ${name}, version ${version}`);
    }
    const agent = await serviceCall("Read agent", () => project.agents.get(name), {
      notFound: existingAgent ? `Agent '${name}' was not found in this project. Check AGENT_NAME.` : undefined,
    });
    const latest = agent.versions.latest;
    definition = latest.definition;
    if (definition.kind !== "voice" || definition.sub_protocol !== "live") {
      throw new DemoError(
        "The agent must use sub_protocol=live. Check AGENT_NAME or the created agent definition.",
      );
    }
    if (existingAgent) {
      version = latest.version;
      display.status(`Using existing agent: ${name}, version ${version}`);
      await checkDeployments(project, definitionDeployments(definition), display);
    }
    const delegation = definition.delegation ?? {};
    const managedDelegation = delegation.type === "foundry_managed_agent";
    const backendModel = managedDelegation
      ? `${delegation.agent_name}:${delegation.agent_version ?? "active"}`
      : (delegation.responses?.model ?? delegation.type ?? "client");

    // The SDK opens the agent's .../endpoint/protocols/voice/live/sessions WebSocket with the
    // same credential and preview header, and resolves once Foundry reports session.started.
    const connection = await project.beta.voiceAgents.live.connect(name, {
      agentVersionOverride: String(version),
    });
    const result = await converse(connection, { input, backendModel, managedDelegation, display, timing });
    if (args.output) {
      await writePcmWav(args.output, result.outputAudio);
      display.status(`Saved the spoken reply: ${args.output}`);
    }
    if (!result.conversationId) {
      display.status("No persisted conversation id was returned.");
    } else {
      display.status(`Conversation id: ${result.conversationId}`);
      if (created && args.autoDelete) {
        display.status(
          "The agent will be deleted (--auto-delete). Omit this option to download the conversation later.",
        );
      } else {
        printDownloadCommand(display, base, name, result.conversationId);
      }
    }
    return result;
  } finally {
    if (created && args.autoDelete) {
      try {
        await project.agents.delete(name);
        display.status(`Deleted temporary demo agent: ${name}`);
      } catch (error) {
        if (error?.statusCode === 404) display.status(`Deleted temporary demo agent: ${name}`);
        else display.status(`Cleanup failed (${error?.name ?? "Error"}); delete agent ${name} manually.`);
      }
    } else if (created) {
      display.status(`Kept agent: ${name}. Delete it in your Foundry project when finished.`);
    }
  }
}

await runCli(import.meta.url, main, USAGE);
