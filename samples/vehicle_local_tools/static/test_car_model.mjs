import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { DOORS, LIDS, WHEELS, OPEN_ANGLE, WINDOW_DROP, WINDOW_INSET, WHEEL_RADIUS, WHEEL_ANGULAR_SPEED, wheelAngle, doorPlanes, windowSillPlane, partRegions, partitionVehicle, readSTL, clipSurface, profileRegion, wheelRimRegion, frontRoofEdgeHeight } from "./car-model.mjs";
import { Vector3, Quaternion } from "three";
import { cleanSurface, lining } from "../tools/vehicle-surface.mjs";

const source = await readFile(new URL("./complete.stl", import.meta.url));
const positions = readSTL(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
const parts = partitionVehicle(positions);
const glb = await readFile(new URL("./vehicle-doors.glb", import.meta.url));
const jsonLength = glb.readUInt32LE(12);
const document = JSON.parse(glb.toString("utf8", 20, 20 + jsonLength).trim());
const binaryStart = 20 + jsonLength + 8;
const nodeIndex = (name) => document.nodes.findIndex((node) => node.name === name);
function rawValues(id) {
  const accessor = document.accessors[id], view = document.bufferViews[accessor.bufferView];
  const result = [];
  assert.ok([5125, 5126].includes(accessor.componentType));
  for (let i = 0; i < view.byteLength; i += 4) {
    const offset = binaryStart + view.byteOffset + i;
    result.push(accessor.componentType === 5125 ? glb.readUInt32LE(offset) : glb.readFloatLE(offset));
  }
  return result;
}
const indexedAttributes = new Map(document.meshes.flatMap((mesh) => mesh.primitives.flatMap((primitive) =>
  Object.values(primitive.attributes).map((id) => [id, primitive.indices]))));
function values(id) {
  const raw = rawValues(id), indexAccessor = indexedAttributes.get(id);
  if (indexAccessor === undefined) return raw;
  return rawValues(indexAccessor).flatMap((index) => raw.slice(index * 3, index * 3 + 3));
}
function area(positions) {
  let sum = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const a = [positions[i + 3] - positions[i], positions[i + 4] - positions[i + 1], positions[i + 5] - positions[i + 2]];
    const b = [positions[i + 6] - positions[i], positions[i + 7] - positions[i + 1], positions[i + 8] - positions[i + 2]];
    sum += Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]) / 2;
  }
  return sum;
}
function track(clip, name) {
  const animation = document.animations.find((clipInfo) => clipInfo.name === clip);
  assert.ok(animation, clip);
  const channel = animation.channels.find((item) => item.target.node === nodeIndex(name));
  assert.ok(channel, `${clip}: ${name}`);
  return { ...channel.target, values: values(animation.samplers[channel.sampler].output) };
}
function sourceProjection(first, second, axis, side) {
  let found = null, nearest = -Infinity;
  const [u, v] = axis === 0 ? [1, 2] : [0, 1];
  for (const [name, vertices] of Object.entries(parts)) for (let i = 0; i < vertices.length; i += 9) {
    const [ay, az, by, bz, cy, cz] = [u, v, u + 3, v + 3, u + 6, v + 6].map((offset) => vertices[i + offset]);
    const denominator = (bz - cz) * (ay - cy) + (cy - by) * (az - cz);
    if (Math.abs(denominator) < 1e-10) continue;
    const a = ((bz - cz) * (first - cy) + (cy - by) * (second - cz)) / denominator;
    const b = ((cz - az) * (first - cy) + (ay - cy) * (second - cz)) / denominator, c = 1 - a - b;
    if (Math.min(a, b, c) < -1e-6) continue;
    const x = (a * vertices[i + axis] + b * vertices[i + 3 + axis] + c * vertices[i + 6 + axis]) * side;
    if (x > nearest) { nearest = x; found = name; }
  }
  assert.ok(nearest > 1.5, `No surface at ${first}, ${second} along axis ${axis}`);
  return { part: found, depth: nearest };
}
function projectedSurfaceAt(first, second, axis, side) {
  return sourceProjection(first, second, axis, side).part;
}
function sourceSurfaceAt(y, z, side) {
  return projectedSurfaceAt(y, z, 0, side);
}

test("STL is complete, finite and Y-up; invalid input fails explicitly", () => {
  assert.equal(positions.length / 9, 364748);
  for (const value of positions) assert.ok(Number.isFinite(value));
  assert.throws(() => readSTL(new ArrayBuffer(20)), /header/);
  assert.throws(() => readSTL(new ArrayBuffer(84)), /complete binary/);
  const invalid = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  new DataView(invalid).setFloat32(96, NaN, true);
  assert.throws(() => readSTL(invalid), /invalid coordinates/);
});

test("component partition preserves the source surface without lost or duplicated panels", () => {
  const original = area(positions);
  const partitioned = Object.values(parts).reduce((sum, part) => sum + area(part), 0);
  assert.ok(Math.abs(original - partitioned) / original < 0.000001, `${original} vs ${partitioned}`);
  for (const { id, planes, sections } of partRegions()) {
    assert.ok(parts[id].length >= 9 && area(parts[id]) > 1e-6, `${id} must contain real STL geometry`);
    for (let i = 0; i < parts[id].length; i += 3) {
      const p = parts[id].subarray(i, i + 3);
      assert.ok(planes.every(([x, y, z, w]) => x * p[0] + y * p[1] + z * p[2] + w >= -0.00001), id);
      if (sections) assert.ok(sections.some((section) => section.every(([x, y, z, w]) =>
        x * p[0] + y * p[1] + z * p[2] + w >= -1e-5)), `${id}: outside rounded lamp outline`);
    }
  }
});

test("recalibrated door panels stay below the beltline and glass is separate", () => {
  for (const door of DOORS) {
    let minY = Infinity, maxY = -Infinity;
    for (let i = 1; i < parts[door.id].length; i += 3) {
      minY = Math.min(minY, parts[door.id][i]);
      maxY = Math.max(maxY, parts[door.id][i]);
    }
    assert.ok(minY < 1 && maxY < 3.36, door.id);
    assert.ok(parts[`window_${door.id}`].length > 1000);
    assert.ok(Math.abs(door.hinge[2] - (door.front ? 3.48 : -.16)) < 0.00001);
    assert.ok(WINDOW_DROP >= 1.25);
  }
});

test("no painted door skin remains fixed inside either side's door aperture", () => {
  const staticParts = Object.entries(parts).filter(([name]) =>
    name === "body" || name.startsWith("pillar_") || name.includes("glass") && !name.startsWith("window_") || name === "windshield");
  for (const door of DOORS) {
    const profile = doorPlanes(door).slice(1);
    let leftoverArea = 0;
    for (const [, vertices] of staticParts) {
      for (let i = 0; i < vertices.length; i += 9) {
        const point = [0, 1, 2].map((axis) => (vertices[i + axis] + vertices[i + 3 + axis] + vertices[i + 6 + axis]) / 3);
        if (
          point[0] * door.side > 2 &&
          profile.every(([x, y, z, w]) => x * point[0] + y * point[1] + z * point[2] + w > .002)
        ) leftoverArea += area(vertices.subarray(i, i + 9));
      }
    }
    assert.ok(leftoverArea < .000001, `${door.id}: ${leftoverArea.toFixed(6)} surface area was left on the body`);
  }
});

test("all six fixed pillar shells have interior linings and crease-preserving normals", () => {
  const children = new Set(document.nodes.flatMap((node) => node.children));
  for (const side of ["left", "right"]) for (const pillar of ["a", "b", "c"]) {
    const name = `pillar_${pillar}_${side}`;
    assert.ok(parts[name].length > 1000);
    const surface = nodeIndex(`${name}_${pillar === "b" ? 4 : 0}`);
    assert.ok(surface >= 0 && !children.has(surface), `${name} must stay fixed, not parent to a door`);
    assert.ok(nodeIndex(`${name}_lining`) >= 0);
    const primitive = document.meshes[document.nodes[surface].mesh].primitives[0];
    const positions = values(primitive.attributes.POSITION), normals = values(primitive.attributes.NORMAL);
    for (let i = 0; i < positions.length; i += 9) {
      const a = [0, 1, 2].map((axis) => positions[i + 3 + axis] - positions[i + axis]);
      const b = [0, 1, 2].map((axis) => positions[i + 6 + axis] - positions[i + axis]);
      const face = [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
      const magnitude = Math.hypot(...face);
      if (magnitude < 1e-7) continue;
      for (const offset of [0, 3, 6]) {
        const normal = normals.slice(i + offset, i + offset + 3);
        assert.ok(normal.every(Number.isFinite));
        assert.ok(Math.abs(Math.hypot(...normal) - 1) < .00001, name);
        const dot = normal.reduce((sum, value, axis) => sum + value * face[axis] / magnitude, 0);
        assert.ok(dot >= Math.cos(Math.PI / 4) - .00001, `${name}: averaged across an opposing/sharp face`);
      }
    }
  }
});

test("GLB is valid and contains pearl paint, glass, rubber and alloy materials", () => {
  assert.equal(glb.readUInt32LE(0), 0x46546c67);
  assert.equal(glb.readUInt32LE(4), 2);
  assert.equal(glb.readUInt32LE(8), glb.length);
  assert.equal(binaryStart + document.buffers[0].byteLength, glb.length);
  const paint = document.materials[0];
  assert.ok(paint.pbrMetallicRoughness.baseColorFactor.slice(0, 3).every((value) => value >= .9));
  assert.equal(paint.extensions.KHR_materials_clearcoat.clearcoatFactor, 1);
  assert.ok(paint.extensions.KHR_materials_iridescence.iridescenceFactor > 0);
  assert.equal(document.materials[1].alphaMode, "BLEND");
  assert.ok(document.materials[1].pbrMetallicRoughness.baseColorFactor[3] < 1);
  assert.ok(document.materials[2].pbrMetallicRoughness.roughnessFactor > .8);
  assert.ok(document.materials[3].pbrMetallicRoughness.metallicFactor > .9);
  const glass = document.materials[1].pbrMetallicRoughness.baseColorFactor.slice(0, 3);
  assert.ok(Math.max(...glass) - Math.min(...glass) < .015, "reference glass is neutral, not blue");
  assert.ok(document.materials[3].pbrMetallicRoughness.baseColorFactor.slice(0, 3).every((value) => value < .2), "graphite reference wheels");
});

test("GLB reconstructs retained surfaces; original rubber and rear rims are replaced", () => {
  const parents = new Map();
  document.nodes.forEach((node, index) => node.children.forEach((child) => parents.set(child, index)));
  for (const [name, rawPart] of Object.entries(parts)) {
    const wheel = WHEELS.find((item) => item.id === name);
    const donor = wheel && WHEELS.find((item) => item.id === name.replace("wheel_rear_", "wheel_front_"));
    const original = cleanSurface(wheel ? clipSurface(parts[donor.id], wheelRimRegion(donor)) : rawPart);
    if (wheel) for (let i = 0; i < original.length; i++) original[i] += wheel.hinge[i % 3] - donor.hinge[i % 3];
    const transformed = [];
    for (let index = 0; index < document.nodes.length; index++) {
      const node = document.nodes[index];
      if (!new RegExp(`^${name}_[0-9]+$`).test(node.name)) continue;
      const translation = [0, 0, 0];
      for (let current = index; current !== undefined; current = parents.get(current)) {
        document.nodes[current].translation.forEach((value, axis) => { translation[axis] += value; });
      }
      for (const primitive of document.meshes[node.mesh].primitives) {
        const vertices = values(primitive.attributes.POSITION);
        for (let i = 0; i < vertices.length; i++) transformed.push(vertices[i] + translation[i % 3]);
      }
    }
    assert.equal(transformed.length, original.length, name);
    assert.ok(Math.abs(area(transformed) - area(original)) / Math.max(area(original), 1) < .00001, name);
    for (let axis = 0; axis < 3; axis++) {
      const extent = (vertices) => {
        let min = Infinity, max = -Infinity;
        for (let i = axis; i < vertices.length; i += 3) { min = Math.min(min, vertices[i]); max = Math.max(max, vertices[i]); }
        return [min, max];
      };
      const actual = extent(transformed), expected = extent(original);
      assert.ok(actual.every((value, i) => Math.abs(value - expected[i]) < .00002), name);
    }
  }
});

test("rear rims reuse same-side front geometry at the tire axle, with no eccentric offset", () => {
  for (const side of ["left", "right"]) {
    const front = document.nodes[nodeIndex(`wheel_front_${side}_3`)];
    const rear = document.nodes[nodeIndex(`wheel_rear_${side}_3`)];
    const tire = document.nodes[nodeIndex(`wheel_rear_${side}_tire`)];
    assert.equal(rear.mesh, front.mesh, "front and rear use identical centered local rim geometry");
    assert.deepEqual(rear.translation, [0, 0, 0]);
    assert.deepEqual(rear.rotation, [0, 0, 0, 1]);
    const axle = document.nodes[nodeIndex(`wheel_rear_${side}`)];
    assert.ok(axle.children.includes(nodeIndex(`wheel_rear_${side}_3`)));
    assert.ok(axle.children.includes(nodeIndex(`wheel_rear_${side}_tire`)));
    assert.deepEqual(rear.translation, tire.translation);
    const accessor = document.accessors[document.meshes[rear.mesh].primitives[0].attributes.POSITION];
    for (const axis of [1, 2]) assert.ok(Math.abs(accessor.min[axis] + accessor.max[axis]) < .002,
      "rim bounding circle stays centered on its Y/Z axle");
  }
  assert.equal(new Set(WHEELS.map(({ id }) => document.nodes[nodeIndex(`${id}_tire`)].mesh)).size, 1);
});

test("indexed GLB and precompressed variants meet payload budgets without losing triangles", async () => {
  assert.ok(glb.length < 15_000_000, `GLB budget exceeded: ${glb.length}`);
  let uniqueVertices = 0, expandedVertices = 0;
  for (const mesh of document.meshes) for (const primitive of mesh.primitives) {
    assert.notEqual(primitive.indices, undefined, mesh.name);
    const count = document.accessors[primitive.attributes.POSITION].count;
    const indices = rawValues(primitive.indices);
    assert.equal(indices.length % 3, 0);
    assert.ok(indices.every((index) => index < count));
    uniqueVertices += count;
    expandedVertices += indices.length;
  }
  assert.ok(uniqueVertices < expandedVertices * .35, "indexing must eliminate at least 65% of duplicated vertices");
  const gzip = await readFile(new URL("./vehicle-doors.glb.gz", import.meta.url));
  const brotli = await readFile(new URL("./vehicle-doors.glb.br", import.meta.url));
  assert.ok(gzip.length < 8_000_000, `gzip budget exceeded: ${gzip.length}`);
  assert.ok(brotli.length < 6_000_000, `Brotli budget exceeded: ${brotli.length}`);
  assert.deepEqual(gunzipSync(gzip), glb);
  assert.deepEqual(brotliDecompressSync(brotli), glb);
});

test("windows are children of door hinges; both directions have portable animation tracks", () => {
  for (const door of DOORS) {
    const parent = document.nodes[nodeIndex(door.id)];
    assert.deepEqual(parent.translation, door.hinge);
    assert.ok(parent.children.includes(nodeIndex(`window_${door.id}`)));
    const open = track("Open all doors", door.id).values;
    const close = track("Close all doors", door.id).values;
    assert.deepEqual(open.slice(0, 4), [0, 0, 0, 1]);
    assert.deepEqual(close.slice(4), [0, 0, 0, 1]);
    assert.ok(Math.abs(open[5] - Math.sin(-door.side * OPEN_ANGLE / 2)) < .000001);
    const lower = track("Lower all windows", `window_${door.id}`);
    assert.equal(lower.path, "translation");
    assert.ok(Math.abs(lower.values[4] + WINDOW_DROP) < .000001);
    assert.ok(Math.abs(lower.values[3] + door.side * WINDOW_INSET) < .000001);
    assert.equal(track("Raise all windows", `window_${door.id}`).values[4], 0);
    assert.ok(nodeIndex(`${door.id}_lining`) >= 0);
    if (door.front) assert.ok(parent.children.includes(nodeIndex(`mirror_${door.id}_0`)));
  }
});

test("hood/trunk swing upward and four wheels roll around the axle without moving body", () => {
  for (const lid of LIDS) {
    const open = track(`Open ${lid.id}`, lid.id);
    assert.equal(open.path, "rotation");
    assert.ok(Math.abs(open.values[4] - Math.sin(lid.angle / 2)) < .000001);
    assert.deepEqual(track(`Close ${lid.id}`, lid.id).values.slice(4), [0, 0, 0, 1]);
    assert.ok(-Math.sin(lid.angle) * (lid.id === "hood" ? 1 : -1) > 0, "free edge must rise");
  }
  for (const wheel of WHEELS) {
    assert.deepEqual(document.nodes[nodeIndex(wheel.id)].translation, wheel.hinge);
    const rolling = track("Wheel rolling loop", wheel.id);
    assert.equal(rolling.values.length, 20);
    assert.equal(rolling.values[5], 0);
    assert.equal(rolling.values[6], 0);
  }
  assert.ok(document.animations.every((clip) => clip.channels.every((channel) => document.nodes[channel.target.node].name !== "body")));
});

test("measured A-pillar and B-roof points stay painted; belt strips follow frameless doors", () => {
  const roots = document.scenes[0].nodes;
  for (const side of [-1, 1]) {
    const suffix = side > 0 ? "left" : "right";
    for (const [y, z] of [[3.75, 2.2], [4.05, 1.7]]) {
      assert.ok([`pillar_a_${suffix}`, `roof_transition_${suffix}`].includes(sourceSurfaceAt(y, z, side)),
        "A-pillar must remain fixed paint, including its curved roof junction");
    }
    assert.equal(sourceSurfaceAt(3.8, -.5, side), `pillar_b_${suffix}`);
    assert.equal(sourceSurfaceAt(4.36, -.55, side), `roof_paint_${suffix}`, "B trim must not climb onto the roof");
    assert.ok(roots.includes(nodeIndex(`roof_paint_${suffix}_0`)));
    for (const [front, samples] of [[true, [[3.10, 1]]], [false, [[3.26, -2]]]]) {
      const door = `${front ? "front" : "rear"}_${suffix}`, belt = `belt_${door}`;
      for (const [y, z] of samples) assert.equal(sourceSurfaceAt(y, z, side), belt, `${belt} stranded on body or glass`);
      const children = document.nodes[nodeIndex(door)].children;
      assert.ok(children.includes(nodeIndex(`${belt}_4`)));
      assert.ok(children.includes(nodeIndex(`${belt}_lining`)));
      assert.ok(!document.nodes[nodeIndex(`window_${door}`)].children.includes(nodeIndex(`${belt}_4`)), "belt must not lower with glass");
    }
  }
});

test("A-pillar to roof slope is continuous fixed white structure, never moving black trim", () => {
  const roots = document.scenes[0].nodes;
  for (const side of [-1, 1]) {
    const suffix = side > 0 ? "left" : "right", name = `roof_transition_${suffix}`;
    for (const [y, z] of [[3.2, 3.1], [3.4, 2.8], [3.6, 2.5], [3.8, 2.14], [4.0, 1.75]]) {
      assert.ok([`pillar_a_${suffix}`, name].includes(sourceSurfaceAt(y, z, side)), "continuous lower A-pillar line");
    }
    for (const [y, z] of [[4.1, 1.5], [4.2, 1.1], [4.25, .9], [4.29, .7], [4.28, .1]]) {
      assert.equal(sourceSurfaceAt(y, z, side), name, `A/roof junction y=${y}, z=${z} must not open with door`);
    }
    const index = nodeIndex(`${name}_0`);
    assert.ok(roots.includes(index));
    assert.ok(roots.includes(nodeIndex(`${name}_lining`)));
    assert.equal(document.meshes[document.nodes[index].mesh].primitives[0].material, 0);
    for (const door of DOORS) assert.ok(!document.nodes[nodeIndex(door.id)].children.includes(index));
    for (const part of [`pillar_a_${suffix}`, name, `roof_paint_${suffix}`, `window_front_${suffix}`, `belt_front_${suffix}`]) {
      const vertices = parts[part];
      for (let i = 0; i < vertices.length; i += 3) {
        const x = vertices[i] * side, z = vertices[i + 2];
        const glassEdge = 1.83 + (z - 1.27) * (.34 / 3.21);
        assert.ok(x >= glassEdge - 1e-5, `${part}: paint or moving trim protrudes inside the straight windshield edge`);
      }
    }
  }
});

test("outer A/roof junction is a continuous painted curve, not a pointed notch carried by glass", () => {
  const epsilon = 1e-5;
  for (const z of [.8, 2.15]) {
    const y = frontRoofEdgeHeight(z);
    const leftSlope = (y - frontRoofEdgeHeight(z - epsilon)) / epsilon;
    const rightSlope = (frontRoofEdgeHeight(z + epsilon) - y) / epsilon;
    assert.ok(Math.abs(leftSlope - rightSlope) < 1e-4, "no kink at either end of the curved join");
  }
  for (const [z, measuredY] of [[1.175, 4.12805], [1.37, 4.06727], [1.565, 3.99514], [1.76, 3.91632], [1.955, 3.82731]]) {
    assert.ok(Math.abs(frontRoofEdgeHeight(z) - measuredY) < .022, "curve follows the measured native crease");
  }
  for (const side of [-1, 1]) {
    const suffix = side > 0 ? "left" : "right";
    for (let i = 0; i <= 16; i++) {
      const z = 1.05 + i * (2.1 - 1.05) / 16;
      assert.equal(sourceSurfaceAt(frontRoofEdgeHeight(z) + .008, z, side), `roof_transition_${suffix}`,
        "entire lower paint edge stays on the body, not just isolated sample points");
    }
    assert.equal(sourceSurfaceAt(4.06298, 1.435, side), `roof_transition_${suffix}`,
      "reported notch point was previously part of the front window");
    const glass = cleanSurface(parts[`window_front_${suffix}`]);
    for (let i = 0; i < glass.length; i += 3) {
      const y = glass[i + 1], z = glass[i + 2];
      if (z > .8 && z < 2.15) {
        assert.ok(y <= frontRoofEdgeHeight(z) - .03 + 1e-5, "pane must stop below the curved fixed seal");
      }
    }
  }
});

test("front and rear roof headers are separate fixed opaque piano-black body members", () => {
  const roots = document.scenes[0].nodes;
  const material = document.materials.findIndex((item) => item.name === "Opaque piano-black roof structure");
  assert.ok(material >= 0);
  const finish = document.materials[material];
  assert.equal(finish.alphaMode, "OPAQUE");
  assert.equal(finish.pbrMetallicRoughness.baseColorFactor[3], 1);
  assert.ok(finish.pbrMetallicRoughness.baseColorFactor.slice(0, 3).every((value) => value < .02));
  assert.ok(finish.pbrMetallicRoughness.roughnessFactor < .2);
  assert.equal(finish.extensions.KHR_materials_clearcoat.clearcoatFactor, 1);
  for (const end of ["front", "rear"]) {
    const name = `roof_header_${end}`, index = nodeIndex(`${name}_${material}`);
    assert.ok(roots.includes(index), `${name} must not follow doors or windows`);
    assert.equal(document.meshes[document.nodes[index].mesh].primitives[0].material, material);
    assert.ok(area(parts[name]) > .5, `${name} must span a real roof crossmember`);
    assert.ok(document.animations.every((clip) => clip.channels.every((channel) => channel.target.node !== index)));
  }
  for (const [name, vertices] of Object.entries(parts)) for (let i = 0; i < vertices.length; i += 9) {
    const [x, y, z] = [0, 1, 2].map((axis) => (vertices[i + axis] + vertices[i + 3 + axis] + vertices[i + 6 + axis]) / 3);
    if (y > 4.16 && z > 1.11 && z < 1.33 && Math.abs(x) < 1.83 + (z - 1.27) * (.34 / 3.21) - .002) {
      assert.equal(name, "roof_header_front", "no painted notch or moving glass may interrupt the front header");
    }
  }
});

test("inner A/roof returns stay fixed and rear panes stop before the quarter-window pillar", () => {
  for (const side of [-1, 1]) {
    const suffix = side > 0 ? "left" : "right";
    const name = `roof_transition_${suffix}`, index = nodeIndex(`${name}_0`);
    const inner = clipSurface(parts[name], { planes: [[-side, 0, 0, 2.02],
      [0, 1, 0, -4.0], [0, 0, 1, -.866], [0, 0, -1, 1.833]] });
    assert.ok(area(inner) > .001, "actual inner roof fragments must be recovered by the curved rail");
    assert.ok(document.scenes[0].nodes.includes(index));
    assert.ok(document.scenes[0].nodes.includes(nodeIndex(`${name}_lining`)));
    const front = cleanSurface(parts[`window_front_${suffix}`]);
    for (let i = 0; i < front.length; i += 3) {
      const [x, y, z] = front.subarray(i, i + 3);
      assert.ok(!(x * side < 2.019 && z > .866 && z < 1.833 && y > 4.0),
        "inboard A/roof tab may not move or lower with the front pane");
    }
    const rear = parts[`window_rear_${suffix}`];
    for (let i = 0; i < rear.length; i += 3) {
      const y = rear[i + 1], z = rear[i + 2];
      assert.ok(z + (.32 / .63) * (y - 3.35) >= -3.05 - 1e-5,
        "rear pane may not include the fixed triangular quarter window");
    }
    assert.ok(document.scenes[0].nodes.includes(nodeIndex(`quarter_glass_${suffix}_1`)));
  }
});

test("old inboard tire skins are removed and no retained rim triangle crosses the bead radius", () => {
  for (const wheel of WHEELS) {
    const region = partRegions().find(({ id }) => id === wheel.id);
    assert.ok(area(clipSurface(parts.body, region)) < 1e-5, "no stationary source skin inside the full wheel volume");
    const inner = clipSurface(parts[wheel.id], {
      planes: [[-Math.sign(wheel.hinge[0]), 0, 0, 2.14]],
    });
    assert.ok(area(inner) > .2, "previously missed inboard wheel faces must be captured");
    const rim = document.meshes[document.nodes[nodeIndex(`${wheel.id}_3`)].mesh].primitives[0];
    const vertices = values(rim.attributes.POSITION);
    for (let i = 0; i < vertices.length; i += 3) {
      assert.ok(Math.hypot(vertices[i + 1], vertices[i + 2]) <= .85001,
        "clip whole rim triangles, not just their centroids, to remove old rubber strips");
    }
  }
});

test("rear cabin has a continuous bulkhead, parcel shelf and cargo floor behind the bench", () => {
  const bounds = (name) => {
    const index = nodeIndex(name);
    assert.ok(index >= 0 && document.scenes[0].nodes.includes(index), `${name} is fixed cabin geometry`);
    const primitive = document.meshes[document.nodes[index].mesh].primitives[0];
    return document.accessors[primitive.attributes.POSITION];
  };
  const wall = bounds("Rear cabin bulkhead"), shelf = bounds("Rear parcel shelf");
  assert.ok(wall.min[1] <= 1.05 && wall.max[1] >= 3.03);
  assert.ok(wall.min[0] <= -2.05 && wall.max[0] >= 2.05);
  assert.ok(shelf.max[2] >= wall.max[2] - 1e-5 && shelf.min[2] <= -5.75);
  assert.ok(shelf.min[1] < wall.max[1], "shelf must meet the top of the cabin partition");
  const floor = bounds("Cargo forward floor");
  assert.ok(floor.max[2] >= wall.min[2] - 1e-5 && floor.min[2] < -5.80);
  for (const x of [-1.34, 0, 1.34]) {
    assert.ok(bounds(`Rear seat back ${x}`).min[2] > wall.max[2], "rear backrest stays on the cabin side");
  }
  for (const name of ["Rear cabin bulkhead", "Rear parcel shelf", "Cargo forward floor",
    "Cargo forward side -1", "Cargo forward side 1"]) {
    const primitive = document.meshes[document.nodes[nodeIndex(name)].mesh].primitives[0];
    const p = values(primitive.attributes.POSITION);
    for (let i = 0; i < p.length; i += 3) {
      if (Math.abs(p[i]) < .01) continue;
      const hull = sourceProjection(p[i + 1], p[i + 2], 0, Math.sign(p[i]));
      assert.ok(Math.abs(p[i]) < hull.depth - .025, `${name}: interior must stay inside the source body`);
    }
  }
});

test("dashboard, steering wheel and both displays are persistent fixed GLB geometry", () => {
  for (const name of ["Dashboard upper", "Dashboard lower", "Front footwell bulkhead", "Instrument binnacle", "Instrument display",
    "Steering column", "Steering wheel rim", "Steering wheel hub", "Steering spoke -1", "Steering spoke 1",
    "Steering lower spoke", "Center console", "Center control screen", "Screen route turn"]) {
    const index = nodeIndex(name);
    assert.ok(index >= 0 && document.scenes[0].nodes.includes(index), name);
    const primitive = document.meshes[document.nodes[index].mesh].primitives[0];
    const a = document.accessors[primitive.attributes.POSITION];
    assert.ok(a.count >= 6 && a.min[1] > 1 && a.max[1] < 3.6, name);
    assert.ok(a.min[0] > -2.3 && a.max[0] < 2.3 && a.min[2] > -.1 && a.max[2] < 3.6, name);
    assert.ok(document.animations.every((clip) => clip.channels.every((channel) => channel.target.node !== index)));
  }
  assert.ok(document.materials.some(({ name }) => name === "Display blue graphics"));
});

test("four replacement tires are closed, consistently wound shells with full-width sidewalls", () => {
  for (const wheel of WHEELS) {
    const index = nodeIndex(`${wheel.id}_tire`), node = document.nodes[index];
    assert.ok(document.nodes[nodeIndex(wheel.id)].children.includes(index));
    const primitive = document.meshes[node.mesh].primitives[0];
    assert.equal(primitive.material, 2);
    const vertices = values(primitive.attributes.POSITION), edges = new Map();
    let minX = Infinity, maxX = -Infinity, maxRadius = 0, volume = 0;
    const key = (p) => p.map((n) => Math.round(n * 100000)).join(",");
    for (let i = 0; i < vertices.length; i += 9) {
      const triangle = [0, 3, 6].map((offset) => vertices.slice(i + offset, i + offset + 3));
      for (const [x, y, z] of triangle) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); maxRadius = Math.max(maxRadius, Math.hypot(y, z));
      }
      volume += new Vector3(...triangle[0]).dot(new Vector3(...triangle[1]).cross(new Vector3(...triangle[2]))) / 6;
      for (let j = 0; j < 3; j++) {
        const a = key(triangle[j]), b = key(triangle[(j + 1) % 3]), id = [a, b].sort().join("/");
        assert.notEqual(a, b, "degenerate tire edge");
        const edge = edges.get(id) ?? { count: 0, winding: 0 };
        edge.count++; edge.winding += a < b ? 1 : -1; edges.set(id, edge);
      }
    }
    for (const edge of edges.values()) { assert.equal(edge.count, 2, "open/damaged tire edge"); assert.equal(edge.winding, 0); }
    assert.ok(volume > .5, "outward winding and positive solid volume");
    assert.ok(Math.abs(maxRadius - WHEEL_RADIUS) < 1e-6);
    assert.ok(maxX - minX > .63);
    assert.ok(Math.abs(wheel.hinge[0]) + maxX < 2.9, "tire must align with native rim, not float outside it");
    assert.ok(nodeIndex(`${wheel.id}_3`) >= 0, "retain original wheel detail");
  }
});

test("browser and GLB wheels roll forward: bottom contact moves -Z and top moves +Z", () => {
  const dt = .01, delta = wheelAngle(0, dt);
  assert.ok(delta > 0);
  assert.ok(Math.abs(delta / dt - WHEEL_ANGULAR_SPEED) < 1e-8);
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), delta);
  assert.ok(new Vector3(0, -WHEEL_RADIUS, 0).applyQuaternion(rotation).z < 0);
  assert.ok(new Vector3(0, WHEEL_RADIUS, 0).applyQuaternion(rotation).z > 0);
  for (const wheel of WHEELS) {
    const animation = document.animations.find((clip) => clip.name === "Wheel rolling loop");
    const channel = animation.channels.find((item) => item.target.node === nodeIndex(wheel.id));
    const sampler = animation.samplers[channel.sampler], times = values(sampler.input), rotations = values(sampler.output);
    for (let i = 1; i < times.length; i++) {
      const q = new Quaternion(...rotations.slice(i * 4, i * 4 + 4)), expected = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), wheelAngle(0, times[i]));
      assert.ok(Math.abs(q.dot(expected)) > .999999, `${wheel.id} frame ${i}: GLB/browser rolling mismatch`);
    }
    const quarter = new Quaternion(...rotations.slice(4, 8));
    assert.ok(new Vector3(0, -WHEEL_RADIUS, 0).applyQuaternion(quarter).z < -.99);
  }
});

test("all four doors are frameless: no opaque moving geometry survives above the window sill", () => {
  assert.ok(!document.nodes.some((node) => node.name.startsWith("frame_")));
  for (const door of DOORS) {
    const [x, y, z, w] = windowSillPlane(door);
    const pane = parts[`window_${door.id}`];
    for (let i = 0; i < pane.length; i += 3) {
      assert.ok(x * pane[i] + y * (pane[i + 1] - WINDOW_DROP) + z * pane[i + 2] + w < -.02,
        `${door.id}: lowered glass edge still protrudes above the sill`);
    }
    const parent = document.nodes[nodeIndex(door.id)];
    for (const index of parent.children) {
      const node = document.nodes[index];
      if (node.name === `window_${door.id}` || node.name.startsWith("mirror_")) continue;
      assert.notEqual(node.mesh, undefined, node.name);
      for (const primitive of document.meshes[node.mesh].primitives) {
        const vertices = values(primitive.attributes.POSITION);
        for (let i = 0; i < vertices.length; i += 3) {
          const point = vertices.slice(i, i + 3).map((value, axis) => value + door.hinge[axis]);
          assert.ok(x * point[0] + y * point[1] + z * point[2] + w < 1e-5, `${node.name}: opaque upper frame/burr`);
        }
      }
    }
    for (const index of document.nodes[nodeIndex(`window_${door.id}`)].children) {
      for (const primitive of document.meshes[document.nodes[index].mesh].primitives) assert.equal(primitive.material, 1);
    }
  }
  for (const side of [-1, 1]) {
    const suffix = side > 0 ? "left" : "right";
    assert.equal(sourceSurfaceAt(4.28, -1.2, side), `roof_seal_middle_${suffix}`);
    for (const end of ["front", "middle", "rear"]) {
      assert.ok(document.scenes[0].nodes.includes(nodeIndex(`roof_seal_${end}_${suffix}_4`)));
    }
  }
});

test("surface cleanup removes collapsed facets without extruding internal source seams into black fins", () => {
  const triangle = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const degenerate = new Float32Array([...triangle, 0, 0, 0, 1, 0, 0, 2, 0, 0]);
  assert.equal(cleanSurface(degenerate).length, 9);
  assert.equal(lining(triangle, 1, []).length, 9, "an open source seam is not a cut wall");
  assert.equal(lining(triangle, 1, [[1, 0, 0, 0]]).length, 27, "only one actual cut gets a sidewall");
  for (const mesh of document.meshes) for (const primitive of mesh.primitives) {
    const vertices = values(primitive.attributes.POSITION), normals = values(primitive.attributes.NORMAL);
    for (let i = 0; i < vertices.length; i += 9) assert.ok(area(vertices.slice(i, i + 9)) > 1e-12, `${mesh.name}: collapsed burr facet`);
    for (let i = 0; i < normals.length; i += 3) assert.ok(Math.abs(Math.hypot(...normals.slice(i, i + 3)) - 1) < 1e-4, `${mesh.name}: invalid shading normal`);
  }
});

test("rounded concave lamp clipping preserves recesses instead of cutting a rectangular body patch", () => {
  const square = new Float32Array([0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 0, 0, 2, 2, 0, 0, 2, 0]);
  const result = clipSurface(square, profileRegion([[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]], 1));
  assert.ok(Math.abs(area(result) - 3) < 1e-6, "concave outline must not fill the missing corner");
});

test("generated cargo tubs stay inside the original body instead of poking black triangles through bumpers", () => {
  for (const end of ["Front", "Rear"]) {
    const vertices = document.meshes.filter((mesh) => mesh.name.startsWith(`${end} storage `))
      .flatMap((mesh) => values(mesh.primitives[0].attributes.POSITION));
    assert.ok(vertices.length > 0);
    const xs = vertices.filter((_, i) => i % 3 === 0), ys = vertices.filter((_, i) => i % 3 === 1), zs = vertices.filter((_, i) => i % 3 === 2);
    const side = end === "Front" ? 1 : -1, edge = Math.max(...zs.map((z) => z * side));
    for (const x of [Math.min(...xs), Math.max(...xs)]) for (const y of [Math.min(...ys), Math.max(...ys)]) {
      const hull = sourceProjection(x, y, 2, side).depth;
      assert.ok(edge <= hull - .04, `${end} storage corner ${x},${y} protrudes beyond body: ${edge} vs ${hull}`);
    }
  }
});

test("front/rear lamps have measured housings, separate lenses and light signatures; rear inner lamps follow trunk", () => {
  for (let i = 0; i < parts.trunk.length; i += 3) {
    assert.ok(Math.abs(parts.trunk[i]) <= 1.36 + .2 * parts.trunk[i + 1] + 1e-5,
      "trunk must not take the fixed fender surrounding the outer rear lamp");
  }
  for (const side of [-1, 1]) {
    const suffix = side > 0 ? "left" : "right";
    assert.equal(projectedSurfaceAt(side * 2.3, 2.27, 2, 1), `head_lamp_${suffix}`);
    assert.equal(projectedSurfaceAt(side * 1.6, 2.85, 2, -1), `tail_lamp_inner_${suffix}`);
    assert.equal(projectedSurfaceAt(side * 2.3, 2.85, 2, -1), `tail_lamp_outer_${suffix}`);
    for (const kind of ["head_lamp", "tail_lamp_inner", "tail_lamp_outer"]) {
      const name = `${kind}_${suffix}`, root = nodeIndex(`${name}_7`), lens = nodeIndex(`${name}_lens`);
      const parent = kind === "tail_lamp_inner" ? document.nodes[nodeIndex("trunk")].children : document.scenes[0].nodes;
      assert.ok(parent.includes(root) && parent.includes(lens), `${name}: wrong lamp parent`);
      assert.equal(document.meshes[document.nodes[root].mesh].primitives[0].material, 7);
      const lensMaterial = document.meshes[document.nodes[lens].mesh].primitives[0].material;
      assert.equal(document.materials[lensMaterial].alphaMode, "BLEND");
      const feature = nodeIndex(`${name}_${kind === "head_lamp" ? "drl" : "signature"}`);
      assert.ok(parent.includes(feature));
      assert.equal(document.meshes[document.nodes[feature].mesh].primitives[0].material, kind === "head_lamp" ? 5 : 6);
      if (kind === "head_lamp") assert.ok(parent.includes(nodeIndex(`${name}_projector`)));
    }
  }
  assert.ok(document.materials[5].extensions.KHR_materials_emissive_strength.emissiveStrength >= 2);
  assert.ok(document.materials[6].emissiveFactor[0] > document.materials[6].emissiveFactor[1] * 10);
  for (const node of document.nodes.filter((node) => node.name.startsWith("body_") && node.mesh !== undefined)) {
    for (const primitive of document.meshes[node.mesh].primitives) assert.ok(![5, 6].includes(primitive.material), "body must not become a coarse light patch");
  }
});
