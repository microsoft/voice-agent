import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync, constants as zlibConstants } from "node:zlib";
import { BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, TorusGeometry } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import { DOORS, LIDS, WHEELS, OPEN_ANGLE, WINDOW_DROP, WINDOW_INSET, WHEEL_ANGULAR_SPEED, partitionVehicle, readSTL, partRegions, clipSurface, profileRegion, roundedProfile, wheelRimRegion } from "../static/car-model.mjs";
import { tireGeometry } from "./vehicle-tire.mjs";
import { cleanSurface, lining } from "./vehicle-surface.mjs";

const directory = new URL("../static/", import.meta.url);
const three = new URL("../node_modules/three/", import.meta.url);
for (const [source, target] of [
  ["build/three.module.js", "three.module.js"],
  ["build/three.core.js", "three.core.js"],
  ["examples/jsm/controls/OrbitControls.js", "OrbitControls.js"],
  ["examples/jsm/loaders/GLTFLoader.js", "vendor/loaders/GLTFLoader.js"],
  ["examples/jsm/utils/BufferGeometryUtils.js", "vendor/utils/BufferGeometryUtils.js"],
  ["examples/jsm/environments/RoomEnvironment.js", "vendor/environments/RoomEnvironment.js"],
  ["LICENSE", "three-LICENSE.txt"],
]) {
  const destination = new URL(target, directory);
  await mkdir(new URL(".", destination), { recursive: true });
  await copyFile(new URL(source, three), destination);
}
const source = await readFile(new URL("complete.stl", directory));
const parts = partitionVehicle(readSTL(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength)));
const cutPlanes = partRegions().flatMap((region) => [...region.planes, ...(region.boundaryPlanes ?? [])]);
const chunks = [];
const gltf = {
  asset: { version: "2.0", generator: "AURA pearl-white vehicle component rig" },
  scene: 0, scenes: [{ nodes: [] }],
  nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [],
  materials: [{
    name: "Pearl white multilayer paint", doubleSided: true,
    pbrMetallicRoughness: { baseColorFactor: [0.94, 0.945, 0.95, 1], metallicFactor: 0.12, roughnessFactor: 0.27 },
    extensions: {
      KHR_materials_clearcoat: { clearcoatFactor: 1, clearcoatRoughnessFactor: 0.12 },
      KHR_materials_iridescence: { iridescenceFactor: 0.12, iridescenceIor: 1.3, iridescenceThicknessMinimum: 100, iridescenceThicknessMaximum: 220 },
    },
  }, {
    name: "Neutral smoked automotive glass", doubleSided: true, alphaMode: "BLEND",
    pbrMetallicRoughness: { baseColorFactor: [0.065, 0.07, 0.075, 0.72], metallicFactor: 0.08, roughnessFactor: 0.13 },
    extensions: { KHR_materials_clearcoat: { clearcoatFactor: 1, clearcoatRoughnessFactor: 0.05 } },
  }, {
    name: "Tire rubber", pbrMetallicRoughness: { baseColorFactor: [0.016, 0.02, 0.024, 1], metallicFactor: 0, roughnessFactor: 0.89 },
  }, {
    name: "Graphite alloy", pbrMetallicRoughness: { baseColorFactor: [0.10, 0.115, 0.13, 1], metallicFactor: 0.92, roughnessFactor: 0.3 },
  }, {
    name: "Charcoal interior and seals", doubleSided: true,
    pbrMetallicRoughness: { baseColorFactor: [0.025, 0.033, 0.04, 1], metallicFactor: 0, roughnessFactor: 0.86 },
  }, {
    name: "White LED projector and running light", emissiveFactor: [.9, .95, 1],
    pbrMetallicRoughness: { baseColorFactor: [.9, .94, 1, 1], metallicFactor: 0, roughnessFactor: .18 },
    extensions: { KHR_materials_emissive_strength: { emissiveStrength: 2 } },
  }, {
    name: "Ruby rear light signature", emissiveFactor: [1, .015, .005],
    pbrMetallicRoughness: { baseColorFactor: [0.35, 0.006, 0.003, 1], metallicFactor: 0.2, roughnessFactor: 0.18 },
    extensions: { KHR_materials_emissive_strength: { emissiveStrength: 1.8 } },
  }, {
    name: "Opaque piano-black roof structure", doubleSided: true, alphaMode: "OPAQUE",
    pbrMetallicRoughness: { baseColorFactor: [0.012, 0.012, 0.012, 1], metallicFactor: 0.05, roughnessFactor: 0.14 },
    extensions: { KHR_materials_clearcoat: { clearcoatFactor: 1, clearcoatRoughnessFactor: 0.08 } },
  }, {
    name: "Clear headlamp polycarbonate", doubleSided: true, alphaMode: "BLEND",
    pbrMetallicRoughness: { baseColorFactor: [.65, .68, .7, .18], metallicFactor: 0, roughnessFactor: .07 },
    extensions: { KHR_materials_clearcoat: { clearcoatFactor: 1, clearcoatRoughnessFactor: .04 } },
  }, {
    name: "Smoked ruby tail-lamp polycarbonate", doubleSided: true, alphaMode: "BLEND",
    pbrMetallicRoughness: { baseColorFactor: [.35, .008, .005, .26], metallicFactor: 0, roughnessFactor: .12 },
    extensions: { KHR_materials_clearcoat: { clearcoatFactor: 1, clearcoatRoughnessFactor: .05 } },
  }, {
    name: "Warm grey seat upholstery",
    pbrMetallicRoughness: { baseColorFactor: [.27, .29, .30, 1], metallicFactor: 0, roughnessFactor: .92 },
  }, {
    name: "Brushed cabin trim",
    pbrMetallicRoughness: { baseColorFactor: [.32, .35, .38, 1], metallicFactor: .65, roughnessFactor: .42 },
  }, {
    name: "Display blue graphics", emissiveFactor: [.02, .36, .75],
    pbrMetallicRoughness: { baseColorFactor: [.02, .36, .75, 1], metallicFactor: 0, roughnessFactor: .5 },
  }, {
    name: "Display white graphics", emissiveFactor: [.55, .65, .7],
    pbrMetallicRoughness: { baseColorFactor: [.55, .65, .7, 1], metallicFactor: 0, roughnessFactor: .5 },
  }],
  extensionsUsed: ["KHR_materials_clearcoat", "KHR_materials_iridescence", "KHR_materials_emissive_strength"],
  animations: [],
};
let byteLength = 0;
function accessor(array, type, bounds = false) {
  const buffer = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  const view = gltf.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: buffer.length }) - 1;
  chunks.push(buffer);
  byteLength += buffer.length;
  const size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type];
  const entry = { bufferView: view, componentType: array instanceof Uint32Array ? 5125 : 5126, count: array.length / size, type };
  if (bounds) {
    entry.min = Array(size).fill(Infinity);
    entry.max = Array(size).fill(-Infinity);
    for (let i = 0; i < array.length; i++) {
      entry.min[i % size] = Math.min(entry.min[i % size], array[i]);
      entry.max[i % size] = Math.max(entry.max[i % size], array[i]);
    }
  }
  return gltf.accessors.push(entry) - 1;
}
function node(name, translation = [0, 0, 0], parent = null) {
  const id = gltf.nodes.push({ name, translation, rotation: [0, 0, 0, 1], children: [] }) - 1;
  if (parent === null) gltf.scenes[0].nodes.push(id);
  else gltf.nodes[parent].children.push(id);
  return id;
}
const doorNodes = Object.fromEntries(DOORS.map((door) => [door.id, node(door.id, door.hinge)]));
const wheelNodes = Object.fromEntries(WHEELS.map((wheel) => [wheel.id, node(wheel.id, wheel.hinge)]));
const lidNodes = Object.fromEntries(LIDS.map((lid) => [lid.id, node(lid.id, lid.hinge)]));
const windowNodes = Object.fromEntries(DOORS.map((door) => [door.id, node(`window_${door.id}`, [0, 0, 0], doorNodes[door.id])]));

function indexGeometry(geometry) {
  const positions = geometry.getAttribute("position").array, normals = geometry.getAttribute("normal").array;
  const unique = new Map(), indexedPositions = [], indexedNormals = [], indices = [];
  for (let i = 0; i < positions.length; i += 3) {
    // Exact position AND normal keys retain every crease without quantization or decimation.
    const key = `${positions[i]},${positions[i + 1]},${positions[i + 2]},${normals[i]},${normals[i + 1]},${normals[i + 2]}`;
    let index = unique.get(key);
    if (index === undefined) {
      index = unique.size;
      unique.set(key, index);
      indexedPositions.push(positions[i], positions[i + 1], positions[i + 2]);
      indexedNormals.push(normals[i], normals[i + 1], normals[i + 2]);
    }
    indices.push(index);
  }
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(indexedPositions), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(indexedNormals), 3));
  geometry.setIndex(new BufferAttribute(new Uint32Array(indices), 1));
  return geometry;
}
function meshInstance(name, index, parent) {
  const id = node(name, [0, 0, 0], parent);
  gltf.nodes[id].mesh = index;
}
function mesh(name, positions, material, parent, origin = [0, 0, 0]) {
  const local = cleanSurface(positions);
  if (!local.length) throw new Error(`The model has no usable triangles for ${name}.`);
  for (let i = 0; i < local.length; i++) local[i] -= origin[i % 3];
  let geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(local, 3));
  geometry = indexGeometry(toCreasedNormals(geometry, Math.PI / 4));
  const index = gltf.meshes.push({
    name, primitives: [{ attributes: {
      POSITION: accessor(geometry.getAttribute("position").array, "VEC3", true),
      NORMAL: accessor(geometry.getAttribute("normal").array, "VEC3"),
    }, indices: accessor(geometry.index.array, "SCALAR"), material }],
  }) - 1;
  meshInstance(name, index, parent);
  geometry.dispose();
  return index;
}

function lampLayer(name, positions, material, parent, origin, offset) {
  const layer = positions.slice();
  for (let i = 2; i < layer.length; i += 3) layer[i] += offset;
  mesh(name, layer, material, parent, origin);
}
function lampDetails(name, positions, parent, origin, side, head) {
  const offset = head ? 1 : -1;
  lampLayer(`${name}_lens`, positions, head ? 8 : 9, parent, origin, offset * .014);
  const signature = head
    ? [[2.51, 2.43], [2.43, 2.55], [2.34, 2.55], [2.13, 2.38], [1.96, 2.27], [1.68, 2.17],
      [1.61, 2.10], [1.70, 2.14], [1.99, 2.23], [2.16, 2.34], [2.36, 2.50], [2.41, 2.50], [2.47, 2.39]]
    : [[1.40, 2.86], [1.55, 2.99], [1.96, 3.045], [2.30, 3.0], [2.37, 2.91], [2.36, 2.71],
      [1.55, 2.70], [1.55, 2.74], [2.32, 2.75], [2.33, 2.89], [2.28, 2.96], [1.96, 3.005], [1.57, 2.95], [1.44, 2.84]];
  const light = clipSurface(positions, profileRegion(roundedProfile(signature, 1), side));
  lampLayer(`${name}_${head ? "drl" : "signature"}`, light, head ? 5 : 6, parent, origin, offset * .009);
  if (head) {
    const ellipse = Array.from({ length: 48 }, (_, i) => {
      const angle = i * Math.PI * 2 / 48;
      return [2.30 + Math.cos(angle) * .19, 2.27 + Math.sin(angle) * .14];
    });
    lampLayer(`${name}_projector`, clipSurface(positions, profileRegion(ellipse, side)), 5, parent, origin, .009);
  }
}

const frontRims = new Map();
let sharedTire;
for (const [name, positions] of Object.entries(parts)) {
  if (!positions.length) throw new Error(`The model has no geometry for ${name}.`);
  const door = DOORS.find((item) => item.id === name);
  const window = DOORS.find((item) => `window_${item.id}` === name);
  const mirror = DOORS.find((item) => `mirror_${item.id}` === name);
  const belt = DOORS.find((item) => `belt_${item.id}` === name);
  const wheel = WHEELS.find((item) => item.id === name);
  const lid = LIDS.find((item) => item.id === name);
  const pillar = name.startsWith("pillar_");
  const lamp = name.startsWith("head_lamp_") || name.startsWith("tail_lamp_");
  const trunkLamp = name.startsWith("tail_lamp_inner_") ? LIDS.find((item) => item.id === "trunk") : null;
  const parent = door ? doorNodes[name] : window ? windowNodes[window.id] : mirror ? doorNodes[mirror.id] : belt ? doorNodes[belt.id] : wheel ? wheelNodes[name] : lid ? lidNodes[name] : trunkLamp ? lidNodes.trunk : null;
  const origin = (door || window || mirror || belt || wheel || lid || trunkLamp)?.hinge ?? [0, 0, 0];
  if (wheel) {
    if (name.startsWith("wheel_front_")) {
      const rim = clipSurface(positions, wheelRimRegion(wheel));
      frontRims.set(name, mesh(`${name}_3`, rim, 3, parent, origin));
    } else {
      const front = frontRims.get(name.replace("wheel_rear_", "wheel_front_"));
      if (front === undefined) throw new Error(`Missing same-side front rim for ${name}.`);
      meshInstance(`${name}_3`, front, parent);
    }
    if (sharedTire === undefined) {
      const tire = tireGeometry();
      sharedTire = mesh(`${name}_tire`, tire.getAttribute("position").array, 2, parent);
      tire.dispose();
    } else meshInstance(`${name}_tire`, sharedTire, parent);
    console.log(`${name}: centered front rim and shared closed tire`);
    continue;
  }
  const buckets = new Map();
  const retained = positions;
  for (let i = 0; i < retained.length; i += 9) {
    const y = (retained[i + 1] + retained[i + 4] + retained[i + 7]) / 3;
    let material = 0;
    if (name.startsWith("roof_header_") || lamp) material = 7;
    else if (window || name.includes("glass") || name === "windshield") material = 1;
    else if (name.startsWith("pillar_b_") || name.startsWith("roof_seal_") || belt) material = 4;
    else if (name === "body") {
      if (y < .68) material = 4;
    }
    if (!buckets.has(material)) buckets.set(material, []);
    buckets.get(material).push(...retained.subarray(i, i + 9));
  }
  for (const [material, values] of buckets) mesh(`${name}_${material}`, new Float32Array(values), material, parent, origin);
  if (door) mesh(`${name}_lining`, lining(positions, door.side, cutPlanes), 4, parent, origin);
  if (pillar) mesh(`${name}_lining`, lining(positions, name.endsWith("_left") ? 1 : -1, cutPlanes), 4, null);
  if (name.startsWith("roof_transition_")) mesh(`${name}_lining`, lining(positions, name.endsWith("_left") ? 1 : -1, cutPlanes), 4, null);
  if (belt) mesh(`${name}_lining`, lining(positions, belt.side, cutPlanes), 4, parent, origin);
  if (lamp) lampDetails(name, positions, parent, origin, name.endsWith("_left") ? 1 : -1, name.startsWith("head_lamp_"));
  console.log(`${name}: ${positions.length / 9} triangles`);
}
function box(name, size, position, material = 4) {
  solid(name, new BoxGeometry(...size), position, material);
}
function solid(name, geometry, position, material = 4, rotation = [0, 0, 0]) {
  geometry.rotateX(rotation[0]);
  geometry.rotateY(rotation[1]);
  geometry.rotateZ(rotation[2]);
  geometry.translate(...position);
  const surface = geometry.index ? geometry.toNonIndexed() : geometry;
  mesh(name, surface.getAttribute("position").array, material, null);
  if (surface !== geometry) surface.dispose();
  geometry.dispose();
}
function cushion(name, size, position, material = 10, radius = .08) {
  solid(name, new RoundedBoxGeometry(...size, 3, radius), position, material);
}
function taperedBox(name, frontWidth, rearWidth, frontZ, rearZ, y, height) {
  const geometry = new BoxGeometry(1, height, frontZ - rearZ);
  const p = geometry.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const fraction = p.getZ(i) / (frontZ - rearZ) + .5;
    p.setX(i, p.getX(i) * (rearWidth + fraction * (frontWidth - rearWidth)));
  }
  solid(name, geometry, [0, y, (frontZ + rearZ) / 2]);
}
box("Cabin floor", [4.8, .12, 6.5], [0, 1.0, .1]);
for (const x of [-1.05, 1.05]) {
  cushion(`Front seat base ${x}`, [1.35, .32, 1.3], [x, 1.45, 1.4]);
  cushion(`Front seat back ${x}`, [1.3, 1.18, .32], [x, 2.14, .88]);
  cushion(`Front headrest ${x}`, [.65, .42, .25], [x, 2.90, .88]);
  for (const side of [-1, 1]) cushion(`Front seat bolster ${x} ${side}`, [.16, .98, .34],
    [x + side * .53, 2.15, 1.0], 10, .06);
}
box("Rear cabin bulkhead", [4.12, 2.0, .16], [0, 2.04, -2.27]);
taperedBox("Rear parcel shelf", 4.12, 2.65, -2.19, -5.76, 3.04, .12);
taperedBox("Cargo forward floor", 2.65, 2.65, -2.35, -5.81, 1.90, .1);
for (const side of [-1, 1]) box(`Cargo forward side ${side}`, [.1, 1.14, 3.41],
  [side * 1.325, 2.47, -4.055]);
for (const x of [-1.34, 0, 1.34]) {
  cushion(`Rear bench cushion ${x}`, [1.30, .32, 1.25], [x, 1.46, -1.48]);
  cushion(`Rear seat back ${x}`, [1.30, 1.27, .26], [x, 2.15, -2.045]);
  cushion(`Rear headrest ${x}`, [.62, .37, .24], [x, 2.92, -2.08]);
}
cushion("Dashboard lower", [4.24, .48, .92], [0, 2.73, 2.92], 4, .13);
box("Front footwell bulkhead", [4.3, 1.95, .22], [0, 1.99, 3.40]);
cushion("Dashboard upper", [4.32, .17, 1.04], [0, 3.0, 2.96], 4, .07);
cushion("Dashboard bright trim", [4.10, .035, .05], [0, 2.83, 2.443], 11, .012);
for (const x of [-1.65, -.95, .55, 1.65]) {
  cushion(`Dashboard vent ${x}`, [.47, .095, .035], [x, 2.89, 2.44], 7, .02);
  for (const y of [2.868, 2.905]) box(`Vent vane ${x} ${y}`, [.40, .009, .008], [x, y, 2.419], 11);
}
cushion("Instrument binnacle", [1.28, .49, .39], [1.05, 3.31, 2.72], 4, .10);
cushion("Instrument display", [1.08, .31, .035], [1.05, 3.33, 2.509], 7, .025);
for (const x of [.68, 1.42]) box(`Instrument indicator ${x}`, [.17, .024, .009], [x, 3.30, 2.486], 12);
for (const [x, y, w, h] of [[1.00, 3.33, .018, .12], [1.10, 3.33, .018, .12],
  [1.05, 3.39, .10, .018], [1.05, 3.27, .10, .018]]) {
  box(`Instrument zero ${x} ${y}`, [w, h, .008], [x, y, 2.486], 13);
}
cushion("Center console", [.62, .62, 1.86], [0, 1.56, 1.14], 4, .10);
cushion("Console armrest", [.64, .17, .64], [0, 1.94, .57], 10, .06);
for (const z of [1.23, 1.61]) {
  solid(`Console cup rim ${z}`, new TorusGeometry(.14, .022, 8, 32), [0, 1.883, z], 11, [-Math.PI / 2, 0, 0]);
  solid(`Console cup well ${z}`, new CylinderGeometry(.12, .12, .015, 32), [0, 1.868, z], 7);
}
solid("Steering column", new CylinderGeometry(.105, .12, .65, 24), [1.05, 2.79, 2.27], 4, [Math.PI / 2 - .18, 0, 0]);
function steeringPart(name, geometry, offset, material) {
  geometry.translate(...offset);
  solid(name, geometry, [1.05, 2.87, 1.94], material, [-.18, 0, 0]);
}
steeringPart("Steering wheel rim", new TorusGeometry(.45, .057, 12, 64), [0, 0, 0], 4);
steeringPart("Steering wheel hub", new RoundedBoxGeometry(.40, .26, .14, 3, .055), [0, -.015, -.02], 4);
for (const side of [-1, 1]) {
  steeringPart(`Steering spoke ${side}`, new RoundedBoxGeometry(.28, .09, .075, 2, .025), [side * .29, -.035, 0], 11);
  steeringPart(`Steering button ${side}`, new CylinderGeometry(.034, .034, .02, 16).rotateX(Math.PI / 2), [side * .27, -.025, -.05], 7);
}
steeringPart("Steering lower spoke", new RoundedBoxGeometry(.09, .30, .07, 2, .025), [0, -.29, 0], 11);
cushion("Center screen support", [.18, .42, .18], [-.20, 2.78, 2.34], 4, .04);
cushion("Center screen bezel", [1.26, .82, .095], [-.20, 3.05, 2.20], 11, .045);
cushion("Center control screen", [1.19, .75, .02], [-.20, 3.05, 2.14], 7, .025);
for (const x of [-.48, -.28, -.08, .12]) box(`Screen map grid vertical ${x}`, [.008, .49, .008], [x, 3.08, 2.124], 11);
for (const y of [2.9, 3.1, 3.3]) box(`Screen map grid horizontal ${y}`, [.91, .008, .008], [-.2, y, 2.123], 11);
box("Screen route lower", [.038, .24, .01], [-.28, 2.99, 2.115], 12);
box("Screen route turn", [.25, .038, .01], [-.174, 3.1, 2.114], 12);
box("Screen route upper", [.038, .20, .01], [-.06, 3.18, 2.115], 12);
for (const x of [-.62, -.42, -.22, -.02, .18]) cushion(`Screen control icon ${x}`,
  [.095, .045, .008], [x, 2.752, 2.118], 13, .004);
for (const [name, x, y, z, depth] of [["Front", 3.65, 1.55, 5.65, 1.5], ["Rear", 2.65, 1.90, -6.12, .72]]) {
  box(`${name} storage floor`, [x, .1, depth], [0, y, z]);
  for (const side of [-1, 1]) {
    box(`${name} storage side ${side}`, [.1, .5, depth], [side * (x / 2), y + .25, z]);
    box(`${name} storage end ${side}`, [x, .5, .1], [0, y + .25, z + side * depth / 2]);
  }
}

function clip(name, targets) {
  const animation = { name, samplers: [], channels: [] };
  const times = accessor(new Float32Array([0, 1]), "SCALAR", true);
  for (const { id, path, start, end } of targets) {
    const values = accessor(new Float32Array([...start, ...end]), path === "rotation" ? "VEC4" : "VEC3");
    const sampler = animation.samplers.push({ input: times, output: values, interpolation: "LINEAR" }) - 1;
    animation.channels.push({ sampler, target: { node: id, path } });
  }
  gltf.animations.push(animation);
}
const quaternion = (angle, axis) => [axis === 0 ? Math.sin(angle / 2) : 0, axis === 1 ? Math.sin(angle / 2) : 0, 0, Math.cos(angle / 2)];
for (const opening of [true, false]) {
  clip(opening ? "Open all doors" : "Close all doors", DOORS.map((door) => ({
    id: doorNodes[door.id], path: "rotation",
    start: quaternion(opening ? 0 : -door.side * OPEN_ANGLE, 1),
    end: quaternion(opening ? -door.side * OPEN_ANGLE : 0, 1),
  })));
  clip(opening ? "Lower all windows" : "Raise all windows", DOORS.map((door) => ({
    id: windowNodes[door.id], path: "translation",
    start: [opening ? 0 : -door.side * WINDOW_INSET, opening ? 0 : -WINDOW_DROP, 0],
    end: [opening ? -door.side * WINDOW_INSET : 0, opening ? -WINDOW_DROP : 0, 0],
  })));
  for (const lid of LIDS) clip(`${opening ? "Open" : "Close"} ${lid.id}`, [{
    id: lidNodes[lid.id], path: "rotation",
    start: quaternion(opening ? 0 : lid.angle, 0), end: quaternion(opening ? lid.angle : 0, 0),
  }]);
}
// Quarter-turn keys avoid the quaternion shortest-path ambiguity of a full turn.
const rolling = { name: "Wheel rolling loop", samplers: [], channels: [] };
const period = Math.PI * 2 / WHEEL_ANGULAR_SPEED;
const times = accessor(new Float32Array([0, .25, .5, .75, 1].map((value) => value * period)), "SCALAR", true);
for (const wheel of WHEELS) {
  const values = accessor(new Float32Array([0, 1, 2, 3, 4].flatMap((i) => quaternion(i * Math.PI / 2, 0))), "VEC4");
  const sampler = rolling.samplers.push({ input: times, output: values, interpolation: "LINEAR" }) - 1;
  rolling.channels.push({ sampler, target: { node: wheelNodes[wheel.id], path: "rotation" } });
}
gltf.animations.push(rolling);
gltf.buffers.push({ byteLength });
const json = Buffer.from(JSON.stringify(gltf));
const padding = (4 - json.length % 4) % 4;
const jsonChunk = Buffer.concat([json, Buffer.alloc(padding, 0x20)]);
const binary = Buffer.concat(chunks);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binary.length, 8);
header.writeUInt32LE(jsonChunk.length, 12);
header.writeUInt32LE(0x4e4f534a, 16);
const binaryHeader = Buffer.alloc(8);
binaryHeader.writeUInt32LE(binary.length, 0);
binaryHeader.writeUInt32LE(0x004e4942, 4);
const output = new URL("vehicle-doors.glb", directory);
const model = Buffer.concat([header, jsonChunk, binaryHeader, binary]);
const gzip = gzipSync(model, { level: 9 });
const brotli = brotliCompressSync(model, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 } });
await Promise.all([
  writeFile(output, model),
  writeFile(new URL("vehicle-doors.glb.gz", directory), gzip),
  writeFile(new URL("vehicle-doors.glb.br", directory), brotli),
]);
console.log(`Saved ${fileURLToPath(output)}: ${model.length} bytes; gzip ${gzip.length}; Brotli ${brotli.length}`);
