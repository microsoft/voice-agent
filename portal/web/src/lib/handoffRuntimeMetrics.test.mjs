// Copyright (c) Microsoft. All rights reserved.

import test from "node:test";
import assert from "node:assert/strict";
import {
  activateHandoffNode,
  createHandoffRuntimeMetrics,
  formatHandoffDuration,
  handoffDurationShares,
  recordHandoffLatency,
  recordHandoffUserTurn,
  snapshotHandoffRuntimeMetrics,
  stopHandoffRuntimeMetrics,
} from "./handoffRuntimeMetrics.mjs";

test("accumulates dwell time, visits, and user turns across node changes", () => {
  let state = createHandoffRuntimeMetrics();
  state = activateHandoffNode(state, "$entrypoint", 1000);
  state = recordHandoffUserTurn(state, "$entrypoint");
  state = activateHandoffNode(state, "open_call", 3500);
  state = recordHandoffUserTurn(state, "open_call");
  state = recordHandoffUserTurn(state, "open_call");
  state = activateHandoffNode(state, "$entrypoint", 5000);

  const snapshot = snapshotHandoffRuntimeMetrics(state, 6000);
  assert.deepEqual(snapshot.$entrypoint, {
    durationMs: 3500,
    userTurns: 1,
    visits: 2,
    latencySamplesMs: [],
    latency: null,
    active: true,
  });
  assert.deepEqual(snapshot.open_call, {
    durationMs: 1500,
    userTurns: 2,
    visits: 1,
    latencySamplesMs: [],
    latency: null,
    active: false,
  });
});

test("repeated session updates for the same node do not add visits", () => {
  let state = activateHandoffNode(createHandoffRuntimeMetrics(), "triage", 10);
  state = activateHandoffNode(state, "triage", 50);
  assert.equal(state.nodes.triage.visits, 1);
  assert.equal(snapshotHandoffRuntimeMetrics(state, 110).triage.durationMs, 100);
});

test("stopping freezes the active node duration", () => {
  let state = activateHandoffNode(createHandoffRuntimeMetrics(), "finalize", 200);
  state = stopHandoffRuntimeMetrics(state, 900);
  assert.deepEqual(snapshotHandoffRuntimeMetrics(state, 5000).finalize, {
    durationMs: 700,
    userTurns: 0,
    visits: 1,
    latencySamplesMs: [],
    latency: null,
    active: false,
  });
});

test("summarizes observed latency per node", () => {
  let state = activateHandoffNode(createHandoffRuntimeMetrics(), "triage", 0);
  state = recordHandoffLatency(state, "triage", 420);
  state = recordHandoffLatency(state, "triage", 780);
  state = recordHandoffLatency(state, "triage", 510);
  assert.deepEqual(snapshotHandoffRuntimeMetrics(state, 1000).triage.latency, {
    count: 3,
    latestMs: 510,
    averageMs: 570,
    p50Ms: 510,
    p95Ms: 780,
  });
});

test("dwell shares add up to exactly one hundred percent", () => {
  const shares = handoffDurationShares({
    entry: { durationMs: 2500 },
    triage: { durationMs: 1500 },
    unused: { durationMs: 0 },
  });
  assert.deepEqual(shares, { entry: 62.5, triage: 37.5, unused: 0 });
  assert.equal(Object.values(shares).reduce((sum, share) => sum + share, 0), 100);
});

test("formats short and long dwell durations compactly", () => {
  assert.equal(formatHandoffDuration(2450), "2.5s");
  assert.equal(formatHandoffDuration(45_400), "45s");
  assert.equal(formatHandoffDuration(125_000), "2m 05s");
});
