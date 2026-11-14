import * as THREE from "three";
import { WHEEL_RADIUS } from "./car-model.mjs";
import { WHEEL_RADIUS_M } from "./drive-cycle.mjs";

export const MODEL_UNITS_PER_M = WHEEL_RADIUS / WHEEL_RADIUS_M;
export const LANE_WIDTH = 3.6 * MODEL_UNITS_PER_M;
export const ROAD_START = -50;
export const ROAD_END = 190;
export const MARKER_PERIOD = 12 * MODEL_UNITS_PER_M;
const wrap = (value, length) => ((value % length) + length) % length;

function validateMotion(distanceM, elapsedSeconds) {
  if (!Number.isFinite(distanceM) || distanceM < 0) throw new Error("Invalid road distance.");
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) throw new Error("Invalid traffic time.");
}

export function trafficLayout(seed, distanceM, elapsedSeconds) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("Invalid traffic seed.");
  validateMotion(distanceM, elapsedSeconds);
  let random = seed >>> 0;
  const next = () => {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    return random / 0x100000000;
  };
  return [
    { kind: "car", x: -LANE_WIDTH, z: 30, speedMps: 10 },
    { kind: "car", x: LANE_WIDTH, z: 75, speedMps: 13 },
    { kind: "bicycle", x: LANE_WIDTH * 1.8, z: 5, speedMps: 4.2 },
    { kind: "pedestrian", x: -LANE_WIDTH * 1.85, z: 50, speedMps: 1.3 },
  ].map((actor) => ({
    kind: actor.kind,
    x: actor.x + (next() - .5) * .5,
    z: ROAD_START + wrap(actor.z + next() * 22 +
      (actor.speedMps * (.9 + next() * .2) * elapsedSeconds - distanceM) * MODEL_UNITS_PER_M - ROAD_START,
    ROAD_END - ROAD_START),
  }));
}

function silhouette(kind, material) {
  const group = new THREE.Group();
  const part = (geometry, position) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    group.add(mesh);
    return mesh;
  };
  const limb = (from, to, radius = .22) => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const mesh = part(new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 8),
      a.clone().add(b).multiplyScalar(.5).toArray());
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize());
  };
  if (kind === "car") {
    part(new THREE.BoxGeometry(5.7, 1.7, 12), [0, 1.6, 0]);
    part(new THREE.BoxGeometry(4.5, 1.5, 6), [0, 3.1, -.5]);
    for (const x of [-2.6, 2.6]) for (const z of [-3.8, 3.8]) {
      const wheel = part(new THREE.CylinderGeometry(1, 1, .65, 12), [x, 1, z]);
      wheel.rotation.z = Math.PI / 2;
    }
  } else if (kind === "bicycle") {
    for (const z of [-1.8, 1.8]) {
      const wheel = part(new THREE.TorusGeometry(1, .12, 6, 16), [0, 1, z]);
      wheel.rotation.y = Math.PI / 2;
    }
    for (const [a, b] of [
      [[0, 1, -1.8], [0, 2.2, 0]], [[0, 2.2, 0], [0, 1, 1.8]],
      [[0, 1, -1.8], [0, 1, 1.8]], [[0, 2.2, 0], [0, 3.6, -.3]],
      [[0, 3.6, -.3], [0, 3, 1.3]], [[0, 2.2, 0], [.4, 1.1, .5]],
    ]) limb(a, b, .15);
    part(new THREE.SphereGeometry(.5, 10, 8), [0, 4.2, -.1]);
  } else {
    part(new THREE.SphereGeometry(.55, 10, 8), [0, 4.8, 0]);
    limb([0, 4.1, 0], [0, 2.5, 0], .45);
    limb([0, 2.5, 0], [-.55, .2, .35]);
    limb([0, 2.5, 0], [.55, .2, -.35]);
    limb([0, 3.8, 0], [-.85, 2.5, -.25]);
    limb([0, 3.8, 0], [.85, 2.5, .25]);
  }
  return group;
}

export function createDrivingRoad(seed) {
  const initial = trafficLayout(seed, 0, 0);
  const group = new THREE.Group();
  group.name = "driving-road";
  const plane = (name, width, length, x, y, z, material) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, length), material);
    mesh.name = name;
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  const depth = ROAD_END - ROAD_START, center = (ROAD_END + ROAD_START) / 2;
  plane("shoulder", LANE_WIDTH * 4.5, depth, 0, -.12, center,
    new THREE.MeshStandardMaterial({ color: 0x101e29, roughness: 1 }));
  plane("road", LANE_WIDTH * 3, depth, 0, -.08, center,
    new THREE.MeshStandardMaterial({ color: 0x233541, roughness: 1 }));
  const corridor = new THREE.MeshBasicMaterial({ color: 0x79e8cd, transparent: true, opacity: .04, depthWrite: false });
  plane("assistance-corridor", LANE_WIDTH - .6, depth, 0, -.04, center, corridor);
  const lines = new THREE.MeshBasicMaterial({ color: 0xb8d0dc, transparent: true, opacity: .55, depthWrite: false });
  const markers = [];
  for (const side of [-1, 1]) {
    plane(`edge-${side}`, .18, depth, side * LANE_WIDTH * 1.5, -.02, center, lines);
    for (let z = ROAD_START; z < ROAD_END; z += MARKER_PERIOD) {
      markers.push({ base: z, mesh: plane(`marker-${side}-${markers.length}`, .22, 4.5 * MODEL_UNITS_PER_M,
        side * LANE_WIDTH / 2, -.02, z, lines) });
    }
  }
  const ghost = new THREE.MeshBasicMaterial({ color: 0xb7d3e2, transparent: true, opacity: .28, depthWrite: false });
  const vulnerable = new THREE.MeshBasicMaterial({ color: 0xd0c8ee, transparent: true, opacity: .45, depthWrite: false });
  const actors = initial.map((actor, index) => {
    const mesh = silhouette(actor.kind, actor.kind === "car" ? ghost : vulnerable);
    mesh.name = `traffic-${index}`;
    group.add(mesh);
    return mesh;
  });
  const lead = silhouette("car", ghost);
  lead.name = "lead-vehicle";
  group.add(lead);
  let visualDistanceM = 0, visualElapsedSeconds = 0, initialized = false;
  return {
    group,
    update(distanceM, state, reducedMotion, elapsedSeconds) {
      validateMotion(distanceM, elapsedSeconds);
      // Freeze at the last displayed position, not at a synthetic speed or distance.
      if (!reducedMotion) { visualDistanceM = distanceM; visualElapsedSeconds = elapsedSeconds; }
      const layout = trafficLayout(seed, visualDistanceM, visualElapsedSeconds);
      const phase = wrap(visualDistanceM * MODEL_UNITS_PER_M, MARKER_PERIOD);
      for (const marker of markers) {
        marker.mesh.position.z = ROAD_START + wrap(marker.base - phase - ROAD_START, depth);
      }
      layout.forEach((actor, index) => actors[index].position.set(actor.x, 0, actor.z));
      lines.color.setHex(state.lane_visible ? state.mode === "active" ? 0x79e8cd : 0xb8d0dc : 0xe9aa87);
      corridor.opacity = state.mode === "active" && state.lane_visible ? .12 : .025;
      if (!reducedMotion || !initialized) lead.position.z = state.lead_distance_m * MODEL_UNITS_PER_M;
      initialized = true;
      lead.visible = lead.position.z >= ROAD_START && lead.position.z <= ROAD_END;
      return { phase, distanceM: visualDistanceM, trafficCount: actors.length + Number(lead.visible),
        kinds: [...new Set(layout.map((actor) => actor.kind))].join(","),
        trafficZ: actors.map((actor) => actor.position.z.toFixed(4)).join(",") };
    },
    dispose() {
      const geometries = new Set(), materials = new Set();
      group.traverse((object) => {
        if (object.isMesh) { geometries.add(object.geometry); materials.add(object.material); }
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
    },
  };
}
