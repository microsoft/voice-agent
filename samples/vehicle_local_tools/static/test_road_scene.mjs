import test from "node:test";
import assert from "node:assert/strict";
import { WHEEL_RADIUS } from "./car-model.mjs";
import { wheelAngleForDistance } from "./drive-cycle.mjs";
import { createDrivingRoad, trafficLayout, MODEL_UNITS_PER_M, LANE_WIDTH, ROAD_START, ROAD_END, MARKER_PERIOD } from "./road-scene.mjs";

const state = { mode: "active", lane_visible: true, lead_distance_m: 30 };

test("traffic is seeded, bounded, sparse, and outside the ego lane", () => {
  assert.deepEqual(trafficLayout(42, 100, 10), trafficLayout(42, 100, 10));
  assert.notDeepEqual(trafficLayout(42, 100, 10), trafficLayout(43, 100, 10));
  for (const distance of [0, 1, 200, 10000, 1e8]) {
    const layout = trafficLayout(42, distance, distance / 10);
    assert.equal(layout.length, 4);
    assert.deepEqual([...new Set(layout.map((actor) => actor.kind))], ["car", "bicycle", "pedestrian"]);
    for (const actor of layout) {
      assert.ok(Math.abs(actor.x) > LANE_WIDTH * .9);
      assert.ok(actor.z >= ROAD_START && actor.z < ROAD_END);
    }
  }
  assert.throws(() => trafficLayout(-1, 0, 0), /seed/);
  assert.throws(() => trafficLayout(1, NaN, 0), /distance/);
  for (const time of [undefined, -1, NaN, Infinity]) assert.throws(() => trafficLayout(1, 0, time), /time/);
});

test("actual road meshes move by the wheel-distance scale without allocating actors", () => {
  const road = createDrivingRoad(42);
  try {
    const marker = road.group.getObjectByName("marker--1-0");
    const actor = road.group.getObjectByName("traffic-0");
    const before = road.update(1, state, false, 0), position = marker.position.z, actorZ = actor.position.z;
    const after = road.update(2, state, false, 0);
    assert.ok(Math.abs((before.phase + MODEL_UNITS_PER_M) - after.phase) < 1e-10);
    assert.ok(Math.abs(marker.position.z - position + MODEL_UNITS_PER_M) < 1e-10);
    assert.notEqual(actor.position.z, actorZ);
    assert.equal(road.group.getObjectByName("traffic-0"), actor);
    assert.equal(after.trafficCount, 5);
    assert.equal(road.group.getObjectByName("lead-vehicle").position.z, state.lead_distance_m * MODEL_UNITS_PER_M);
    assert.ok(Math.abs(wheelAngleForDistance(1) * WHEEL_RADIUS - MODEL_UNITS_PER_M) < 1e-10);
    const repeated = road.update(2 + MARKER_PERIOD / MODEL_UNITS_PER_M, state, false, 0);
    assert.ok(Math.abs(repeated.phase - after.phase) < 1e-10);
  } finally { road.dispose(); }
});

test("reduced motion freezes road and independent traffic; assistance reflects authoritative state", () => {
  const road = createDrivingRoad(7);
  try {
    const before = road.update(20, state, false, 1);
    const positions = () => road.group.children.map((object) => object.position.toArray());
    const original = positions();
    assert.deepEqual(road.update(20, state, false, 1), before);
    assert.deepEqual(positions(), original);
    assert.deepEqual(road.update(200, { ...state, lead_distance_m: 5 }, true, 10), before);
    assert.deepEqual(positions(), original);
    assert.notDeepEqual(road.update(200, state, false, 10), before);
    const warning = road.update(200, { ...state, mode: "takeover_required", lane_visible: false, lead_distance_m: 200 }, false, 10);
    assert.equal(warning.trafficCount, 4);
    assert.equal(road.group.getObjectByName("lead-vehicle").visible, false);
    assert.equal(road.group.getObjectByName("marker--1-0").material.color.getHex(), 0xe9aa87);
    assert.equal(road.group.getObjectByName("assistance-corridor").material.opacity, .025);
  } finally { road.dispose(); }
});

test("all surrounding road users move independently while ego distance and road markings stay fixed", () => {
  const road = createDrivingRoad(42);
  try {
    const before = road.update(10, state, false, 1);
    const markers = () => road.group.children.filter((object) => object.name.startsWith("marker-")).map((object) => object.position.z);
    const originalMarkers = markers();
    const positions = before.trafficZ.split(",").map(Number);
    const after = road.update(10, state, false, 1.25);
    assert.equal(after.phase, before.phase);
    assert.equal(after.distanceM, before.distanceM);
    assert.deepEqual(markers(), originalMarkers);
    const depth = ROAD_END - ROAD_START;
    after.trafficZ.split(",").map(Number).forEach((position, index) => {
      const travel = (position - positions[index] + depth) % depth;
      assert.ok(travel > .5 && travel < 12, `Traffic ${index} advances at its own plausible speed`);
    });
    assert.equal(road.group.getObjectByName("lead-vehicle").position.z, state.lead_distance_m * MODEL_UNITS_PER_M);
    const movingEgo = trafficLayout(42, 11, 1.25), stoppedEgo = trafficLayout(42, 10, 1.25);
    movingEgo.forEach((actor, index) => {
      const relativeShift = (stoppedEgo[index].z - actor.z + depth) % depth;
      assert.ok(Math.abs(relativeShift - MODEL_UNITS_PER_M) < 1e-10);
    });
  } finally { road.dispose(); }
});
