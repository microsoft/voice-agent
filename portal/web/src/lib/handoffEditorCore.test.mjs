import assert from "node:assert/strict";
import test from "node:test";

import {
  ENTRYPOINT_ID,
  createSampleDefinition,
  deterministicYaml,
  estimatePipeline,
  ensureEditableDefinition,
  extractLatestAgent,
  layoutHandoffGraph,
  mergeServiceProblems,
  matchesAgentSearch,
  modelEstimate,
  pipelineBrand,
  pipelineComponentOptions,
  pipelineComponentProvider,
  pipelineMetricMinimum,
  pipelineTotals,
  publicationFeatures,
  sideEdgeAnchors,
  smoothOuterEdgePath,
  smoothVerticalEdgePath,
  sortPipelineComponents,
  stableJson,
  validateDefinition,
} from "../../../static/handoff/handoff-core.mjs";

test("shares pipeline estimates between authoring and runtime cards", () => {
  const { preset, pipeline } = estimatePipeline({
    model: "gpt-realtime-2.1",
    voice: "alloy",
    stt: "whisper-1",
  });
  assert.equal(preset.id, "balanced");
  const balancedTotals = pipelineTotals(pipeline);
  assert.ok(Math.abs(balancedTotals.costPerMinute - 0.0574) < 1e-12);
  assert.deepEqual({
    latencyMinMs: balancedTotals.latencyMinMs,
    latencyMaxMs: balancedTotals.latencyMaxMs,
    latencyMs: balancedTotals.latencyMs,
  }, {
    latencyMinMs: 1300,
    latencyMaxMs: 3626,
    latencyMs: 2463,
  });

  const fallback = estimatePipeline({
    model: "custom-model",
    voice: "custom-voice",
    stt: "whisper-1",
  }).pipeline;
  assert.equal(pipelineTotals(fallback), null);
  assert.equal(fallback.model.estimateUnavailable, true);
});

test("keeps current Realtime versions distinct and couples compatible speech stages", () => {
  const realtime = estimatePipeline({
    model: "gpt-realtime",
    voice: "alloy",
    stt: "whisper-1",
  }).pipeline;
  assert.equal(realtime.model.id, "gpt-realtime");
  assert.equal(realtime.stt.id, "whisper-1");
  const realtimeTotals = pipelineTotals(realtime);
  assert.ok(Math.abs(realtimeTotals.costPerMinute - 0.0566) < 1e-12);
  assert.deepEqual({
    latencyMinMs: realtimeTotals.latencyMinMs,
    latencyMaxMs: realtimeTotals.latencyMaxMs,
    latencyMs: realtimeTotals.latencyMs,
  }, {
    latencyMinMs: 800,
    latencyMaxMs: 3126,
    latencyMs: 1963,
  });

  const realtimeModels = pipelineComponentOptions("model")
    .filter((item) => item.architecture === "realtime")
    .map((item) => item.id);
  assert.deepEqual(realtimeModels, [
    "gpt-realtime-2.1",
    "azure-realtime",
    "gpt-realtime-1.5",
    "gpt-realtime-2.1-mini",
    "gpt-realtime",
    "gpt-realtime-mini",
    "gpt-realtime-2",
  ]);
  const realtimeStt = pipelineComponentOptions("stt", {
    model: "gpt-realtime-2.1",
    voice: "alloy",
    stt: "whisper-1",
  });
  assert.equal(realtimeStt.length, 12);
  assert.ok(realtimeStt.every((item) => item.compatible));
  assert.ok(realtimeStt.some((item) => item.id === "whisper-1"));
  assert.ok(realtimeStt.some((item) => item.id === "native-realtime-audio"));
  assert.ok(
    pipelineTotals(estimatePipeline({
      model: "gpt-realtime-2.1",
      voice: "alloy",
      stt: "native-realtime-audio",
    }).pipeline),
  );
  assert.ok(
    pipelineComponentOptions("voice", {
      model: "azure-realtime",
      voice: "ava",
      stt: "azure-speech",
    }).some((item) => item.id === "ava" && item.compatible),
  );
  assert.ok(
    pipelineComponentOptions("voice", {
      model: "azure-realtime",
      voice: "ava",
      stt: "azure-speech",
    }).some((item) => item.id === "alloy" && !item.compatible),
  );
});

test("offers current cascaded models and Voice Live transcription choices", () => {
  const cascadedModels = pipelineComponentOptions("model")
    .filter((item) => item.architecture === "cascaded")
    .map((item) => item.id);
  assert.deepEqual(cascadedModels, [
    "gpt-5.4",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-6-sol",
    "gpt-6.1-sol",
    "gpt-6-luna",
    "gpt-oss-120b",
  ]);
  const transcribers = pipelineComponentOptions("stt", {
    model: "gpt-5.4",
    voice: "en-US-Ava:DragonHDLatestNeural",
    stt: "mai-transcribe-2",
  });

  assert.ok(transcribers.some((item) => item.id === "azure-speech" && item.compatible));
  assert.ok(transcribers.some((item) => item.id === "mai-transcribe-2-streaming" && item.compatible));
  assert.ok(transcribers.some((item) => item.id === "gpt-4o-transcribe-diarize" && !item.compatible));
  assert.ok(transcribers.some((item) => item.id === "whisper-1" && !item.compatible));
});

test("publishes sourced STT and TTS estimates without double-counting native voice", () => {
  const realtimeStt = pipelineComponentOptions("stt", {
    model: "gpt-realtime",
    voice: "alloy",
    stt: "whisper-1",
  });
  assert.equal(realtimeStt.find((item) => item.id === "azure-speech").latencyMs, 1016);
  assert.equal(realtimeStt.find((item) => item.id === "mai-transcribe-2-streaming").latencyMs, 130);
  assert.equal(realtimeStt.find((item) => item.id === "gpt-realtime-whisper").latencyMs, 740);
  assert.equal(realtimeStt.find((item) => item.id === "gpt-4o-transcribe").latencyMs, 637);
  assert.equal(realtimeStt.find((item) => item.id === "whisper-1").latencyMs, 1507);
  assert.equal(realtimeStt.find((item) => item.id === "whisper-1").costPerMinute, 0.003);
  assert.equal(realtimeStt.find((item) => item.id === "gpt-realtime-whisper").costPerMinute, 0.0085);
  assert.equal(realtimeStt.find((item) => item.id === "gpt-transcribe").costPerMinute, 0.00225);
  assert.equal(realtimeStt.find((item) => item.id === "gpt-4o-transcribe").costPerMinute, 0.00175);
  assert.equal(realtimeStt.find((item) => item.id === "gpt-4o-mini-transcribe").costPerMinute, 0.000875);
  assert.equal(
    realtimeStt.find((item) => item.id === "whisper-1").publicRateLabel,
    "$0.006 / audio minute",
  );
  assert.equal(
    realtimeStt.find((item) => item.id === "mai-transcribe-2-streaming").publicRateLabel,
    "$17 / 1M Voice Live speech-input tokens",
  );
  assert.equal(
    realtimeStt.find((item) => item.id === "mai-transcribe-2").costPerMinute,
    0.0051,
  );

  const realtimeVoices = pipelineComponentOptions("voice", {
    model: "gpt-realtime",
    voice: "alloy",
    stt: "whisper-1",
  });
  const alloy = realtimeVoices.find((item) => item.id === "alloy");
  assert.equal(alloy.latencyMs, null);
  assert.equal(alloy.latencyIncludedInModel, true);
  assert.equal(
    realtimeVoices.find((item) => item.id === "en-US-Ava:DragonHDLatestNeural").latencyMs,
    307,
  );
  const realtime = estimatePipeline({
    model: "gpt-realtime",
    stt: "whisper-1",
    voice: "alloy",
  }).pipeline;
  assert.equal(realtime.stt.costPerMinute, 0.003);
  assert.equal(realtime.stt.noAdditionalCost, undefined);
  assert.ok(Math.abs(realtime.model.costPerMinute - 0.0152) < 1e-12);
  assert.equal(
    realtime.model.publicRateLabel,
    "$32 audio input + $4 text input + $16 text output / 1M tokens",
  );
  assert.equal(realtime.voice.costPerMinute, 0.0384);
  assert.equal(
    realtime.voice.publicRateLabel,
    "$64 / 1M native audio-output tokens",
  );
  assert.ok(Math.abs(pipelineTotals(realtime).costPerMinute - 0.0566) < 1e-12);

  const noTranscript = estimatePipeline({
    model: "gpt-realtime",
    stt: "native-realtime-audio",
    voice: "alloy",
  }).pipeline;
  assert.equal(noTranscript.stt.costPerMinute, 0);
  assert.equal(noTranscript.stt.noAdditionalCost, true);
  assert.ok(Math.abs(pipelineTotals(noTranscript).costPerMinute - 0.0536) < 1e-12);
});

test("keeps nonzero Luna component costs visible at full precision", () => {
  const standard = estimatePipeline({
    model: "gpt-5.6-luna",
    stt: "azure-speech",
    voice: "en-US-Ava:DragonHDLatestNeural",
  }).pipeline;
  assert.deepEqual(
    [standard.stt.costPerMinute, standard.model.costPerMinute, standard.voice.costPerMinute],
    [0.0045, 0.000924, 0.0156],
  );
  assert.equal(pipelineTotals(standard).costPerMinute, 0.021024);

  const lite = estimatePipeline({
    model: "gpt-6-luna",
    stt: "azure-speech",
    voice: "en-US-Ava:DragonHDLatestNeural",
  }).pipeline;
  assert.deepEqual(
    [lite.stt.costPerMinute, lite.model.costPerMinute, lite.voice.costPerMinute],
    [0.0045, 0.000154, 0.015],
  );
  assert.equal(lite.stt.publicRateLabel, "$15 / 1M Voice Live speech-input tokens");
  assert.equal(
    lite.model.publicRateLabel,
    "$0.11 text input + $0.44 text output / 1M tokens",
  );
  assert.equal(
    lite.voice.publicRateLabel,
    "$25 / 1M Voice Live speech-output tokens",
  );
  assert.ok(Math.abs(pipelineTotals(lite).costPerMinute - 0.019654) < 1e-12);
  assert.ok(Math.abs(
    pipelineTotals(lite).costPerMinute
      - (lite.stt.costPerMinute + lite.model.costPerMinute + lite.voice.costPerMinute),
  ) < 1e-12);
});

test("labels providers and sorts table metrics by the minimum estimate", () => {
  const models = pipelineComponentOptions("model");
  assert.equal(
    pipelineComponentProvider(
      "voice",
      pipelineComponentOptions("voice", {
        model: "gpt-realtime",
        voice: "alloy",
        stt: "whisper-1",
      }).find((item) => item.id === "en-US-Ava:DragonHDLatestNeural"),
    ),
    "Azure Speech",
  );
  assert.equal(
    pipelineComponentProvider(
      "voice",
      pipelineComponentOptions("voice", {
        model: "gpt-realtime",
        voice: "alloy",
        stt: "whisper-1",
      }).find((item) => item.id === "alloy"),
    ),
    "GPT native",
  );
  const realtime = models.find((item) => item.id === "gpt-realtime");
  assert.equal(pipelineMetricMinimum(realtime, "latency"), realtime.latencyMinMs);
  assert.deepEqual(
    sortPipelineComponents("model", models, { key: "latency", direction: "asc" })
      .slice(0, 3)
      .map((item) => item.id),
    ["gpt-realtime-mini", "azure-realtime", "gpt-realtime-1.5"],
  );
  assert.equal(
    sortPipelineComponents("model", models, { key: "cost", direction: "desc" })[0]
      .costPerMinute,
    Math.max(...models.map((item) => item.costPerMinute)),
  );
});

test("limits Agent-level STT to the intersection of every graph model", () => {
  const transcribers = pipelineComponentOptions("stt", {
    model: "gpt-realtime-2.1",
    models: ["gpt-realtime-2.1", "gpt-5.6-luna"],
    voice: "alloy",
    stt: "whisper-1",
  });
  assert.deepEqual(
    transcribers.filter((item) => item.compatible).map((item) => item.id),
    ["azure-speech", "mai-transcribe", "mai-transcribe-2", "mai-transcribe-2-streaming"],
  );
  assert.match(
    transcribers.find((item) => item.id === "whisper-1").incompatibility,
    /GPT-5\.6 Luna/,
  );
});

test("reports imported model, STT, and voice combinations that capabilities reject", () => {
  const definition = createSampleDefinition();
  definition.handoff.nodes[0].config.model = "gpt-5.6-luna";
  definition.handoff.nodes[0].config.voice = "alloy";
  const problems = validateDefinition(definition);
  assert.ok(problems.some((item) => (
    item.code === "incompatible_transcription_model" && item.objectId === "support"
  )));
  assert.ok(problems.some((item) => (
    item.code === "incompatible_voice" && item.objectId === "support"
  )));
});

test("matches Agent names by case-insensitive partial terms", () => {
  assert.equal(matchesAgentSearch("frontdesk-fluency-v12-baseline", "FLU v12"), true);
  assert.equal(matchesAgentSearch("frontdesk-fluency-v12-baseline", "front base"), true);
  assert.equal(matchesAgentSearch("frontdesk-fluency-v12-baseline", "finance"), false);
  assert.equal(matchesAgentSearch("frontdesk-fluency-v12-baseline", "  "), true);
});

test("anchors reverse edges to the selected left or right node sides", () => {
  const from = { x: 300, y: 500, width: 320, height: 160 };
  const to = { x: 100, y: 100, width: 320, height: 160 };

  assert.deepEqual(sideEdgeAnchors(from, to, -80), {
    side: "left",
    sourceX: 300,
    sourceY: 580,
    targetX: 100,
    targetY: 180,
  });
  assert.deepEqual(sideEdgeAnchors(from, to, 900), {
    side: "right",
    sourceX: 620,
    sourceY: 580,
    targetX: 420,
    targetY: 180,
  });
});

test("classifies prominent node pipeline brands", () => {
  assert.equal(pipelineBrand("stt", "mai-transcribe-2"), "mai");
  assert.equal(pipelineBrand("stt", "whisper-1"), "whisper");
  assert.equal(pipelineBrand("stt", "azure-speech"), "azure");
  assert.equal(pipelineBrand("model", "gpt-realtime-2.1"), "gpt");
  assert.equal(pipelineBrand("voice", "en-US-Ava:DragonHDLatestNeural"), "azure");
});

test("draws every edge as a smooth curve between the exact handle centers", () => {
  const adjacent = smoothVerticalEdgePath(140, 246, 326, 445);
  const jump = smoothOuterEdgePath(140, 246, 326, 1145, 620);
  const feedback = smoothOuterEdgePath(326, 1145, 140, 246, -120);

  assert.equal(adjacent, "M140,246 C140,345.5 326,345.5 326,445");
  assert.doesNotMatch(adjacent, /\bL\b/);
  assert.equal(jump, "M140,246 C620,246 620,1145 326,1145");
  assert.doesNotMatch(jump, /\bL\b/);
  assert.equal(feedback, "M326,1145 C-120,1145 -120,246 140,246");
  assert.doesNotMatch(feedback, /\bL\b/);
});

test("lays out the handoff graph from top to bottom with readable layer gaps", () => {
  const positions = layoutHandoffGraph(
    [ENTRYPOINT_ID, "identify", "billing", "support", "done"],
    [
      { id: "start", source: ENTRYPOINT_ID, target: "identify" },
      { id: "identify_billing", source: "identify", target: "billing" },
      { id: "identify_support", source: "identify", target: "support" },
      { id: "billing_done", source: "billing", target: "done" },
      { id: "support_done", source: "support", target: "done" },
    ],
  );

  assert.ok(positions.get(ENTRYPOINT_ID).y < positions.get("identify").y);
  assert.equal(positions.get("billing").y, positions.get("support").y);
  assert.ok(Math.abs(positions.get("billing").x - positions.get("support").x) >= 372);
  assert.ok(positions.get("billing").y < positions.get("done").y);
  assert.equal(positions.get(ENTRYPOINT_ID).x, positions.get("identify").x);
});

test("keeps cycles finite and places disconnected nodes after the reachable graph", () => {
  const positions = layoutHandoffGraph(
    [ENTRYPOINT_ID, "one", "two", "orphan"],
    [
      { id: "start", source: ENTRYPOINT_ID, target: "one" },
      { id: "forward", source: "one", target: "two" },
      { id: "back", source: "two", target: "one" },
    ],
  );

  assert.ok(positions.get(ENTRYPOINT_ID).y < positions.get("one").y);
  assert.ok(positions.get("one").y < positions.get("two").y);
  assert.ok(positions.get("two").y < positions.get("orphan").y);
  for (const position of positions.values()) {
    assert.ok(Number.isFinite(position.x));
    assert.ok(Number.isFinite(position.y));
  }
});

test("keeps unknown root fields while adding an editable handoff graph", () => {
  const source = {
    kind: "voice",
    instructions: "Root",
    future_capability: { enabled: true, settings: ["one", "two"] },
  };

  const editable = ensureEditableDefinition(source);
  editable.handoff.nodes.push({
    id: "specialist",
    description: "Handle specialist requests.",
    config: { instructions: "Help.", tools: [], tool_choice: "auto" },
  });
  editable.handoff.edges.push({
    id: "start_to_specialist",
    source: ENTRYPOINT_ID,
    target: "specialist",
    description: "Use for specialist requests.",
  });

  assert.deepEqual(editable.future_capability, source.future_capability);
  assert.equal(source.handoff, undefined);
  assert.equal(validateDefinition(editable).filter((item) => item.severity === "error").length, 0);
});

test("JSON and YAML serializers are deterministic over one canonical state", () => {
  const definition = createSampleDefinition();
  const firstJson = stableJson(definition);
  const firstYaml = deterministicYaml(definition);

  assert.equal(stableJson(definition), firstJson);
  assert.equal(deterministicYaml(definition), firstYaml);
  assert.match(firstYaml, /^audio:/);
  assert.match(firstYaml, /handoff:/);
  assert.ok(firstYaml.includes('source: "$entrypoint"'));
});

test("validation returns field and object scoped blocking problems", () => {
  const definition = createSampleDefinition();
  definition.handoff.max_attempts = 1;
  definition.handoff.edges[0].target = "missing";
  definition.handoff.nodes.push({
    id: "orphan",
    description: "",
    config: { instructions: "", tools: {} },
  });

  const problems = validateDefinition(definition);

  assert.ok(problems.some((item) => item.field === "max_attempts" && item.objectKind === "graph"));
  assert.ok(problems.some((item) => item.objectId === "start_to_support" && item.field === "target"));
  assert.ok(problems.some((item) => item.objectId === "orphan" && item.code === "unreachable_node"));
  assert.ok(problems.some((item) => item.objectId === "orphan" && item.field === "tools"));
});

test("validates managed runtime and interim-response fields", () => {
  const definition = createSampleDefinition();
  definition.store = true;
  definition.output_modalities = ["text", "audio"];
  definition.greeting = {
    type: "llm_generated",
    prompt: "Say hello.",
    fallback_text: "Hello.",
  };
  definition.audio = {
    input: {
      format: { type: "audio/pcm", rate: 24000 },
      turn_detection: { type: "azure_semantic_vad", threshold: 0.5 },
    },
    output: {
      format: { type: "audio/pcm", rate: 24000 },
      voice: "en-US-AvaNeural",
      voice_type: "azure-standard",
    },
  };
  definition.handoff.nodes[0].config.interim_response = {
    type: "static_interim_response",
    triggers: ["tool"],
    texts: ["One moment."],
  };
  definition.handoff.nodes[1].config.interim_response = null;
  assert.equal(validateDefinition(definition).filter((item) => item.severity === "error").length, 0);

  definition.greeting.prompt = "";
  definition.audio.input.format.rate = 0;
  definition.audio.input.turn_detection.threshold = 1.2;
  definition.handoff.nodes[0].config.interim_response.texts = [];
  const codes = new Set(validateDefinition(definition).map((item) => item.code));
  assert.ok(codes.has("greeting_prompt"));
  assert.ok(codes.has("audio_rate"));
  assert.ok(codes.has("turn_threshold"));
  assert.ok(codes.has("interim_response_texts"));
});

test("model indicators identify catalog estimates and unknown values honestly", () => {
  assert.deepEqual(modelEstimate("gpt-realtime-mini"), {
    latency: "Low",
    cost: "Low",
    source: "Estimated from Voice Live guidance and public retail tier",
    available: true,
  });
  assert.deepEqual(modelEstimate("custom-deployment"), {
    latency: "Not available",
    cost: "Not available",
    source: "No estimate for custom or unknown values",
    available: false,
  });
});

test("draft publication adds the required preview feature without duplicates", () => {
  assert.equal(
    publicationFeatures("VoiceAgents=V1Preview", false),
    "VoiceAgents=V1Preview",
  );
  assert.equal(
    publicationFeatures("VoiceAgents=V1Preview", true),
    "VoiceAgents=V1Preview,DraftAgents=V1Preview",
  );
  assert.equal(
    publicationFeatures(
      "VoiceAgents=V1Preview,DraftAgents=V1Preview",
      true,
    ),
    "VoiceAgents=V1Preview,DraftAgents=V1Preview",
  );
});

test("extracts latest complete definition and maps service validation details", () => {
  const definition = createSampleDefinition();
  definition.unknown_root = "preserved";
  const agent = extractLatestAgent({
    name: "handoff-agent",
    versions: {
      latest: {
        version: "12",
        draft: false,
        definition,
        metadata: { owner: "voice" },
      },
    },
  });

  assert.equal(agent.version, "12");
  assert.equal(agent.definition.unknown_root, "preserved");
  const problems = mergeServiceProblems([], {
    error: {
      details: [{
        code: "handoff_unknown_node",
        object_kind: "edge",
        object_id: "edge-a",
        field: "target",
        message: "Target does not exist.",
      }],
    },
  });
  assert.deepEqual(problems[0], {
    severity: "error",
    message: "Target does not exist.",
    objectKind: "edge",
    objectId: "edge-a",
    field: "target",
    code: "handoff_unknown_node",
    server: true,
  });
});
