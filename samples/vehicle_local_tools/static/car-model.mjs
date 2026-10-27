import { ShapeUtils, Vector2 } from "three";

export function readSTL(buffer) {
  if (buffer.byteLength < 84) throw new Error("The vehicle STL header is incomplete.");
  const data = new DataView(buffer);
  const count = data.getUint32(80, true);
  if (!count || 84 + count * 50 !== buffer.byteLength) {
    throw new Error("Expected a complete binary STL vehicle model.");
  }
  const positions = new Float32Array(count * 9);
  for (let face = 0; face < count; face++) {
    for (let corner = 0; corner < 3; corner++) {
      const offset = 84 + face * 50 + 12 + corner * 12;
      const x = data.getFloat32(offset, true);
      const y = data.getFloat32(offset + 4, true);
      const z = data.getFloat32(offset + 8, true);
      if (![x, y, z].every(Number.isFinite)) throw new Error("The vehicle mesh contains invalid coordinates.");
      const index = face * 9 + corner * 3;
      positions[index] = x;
      positions[index + 1] = z;
      positions[index + 2] = -y;
    }
  }
  return positions;
}

export const DOORS = [
  { id: "front_left", label: "Front left", side: 1, front: true, hinge: [2.85, 1, 3.48] },
  { id: "front_right", label: "Front right", side: -1, front: true, hinge: [-2.85, 1, 3.48] },
  { id: "rear_left", label: "Rear left", side: 1, front: false, hinge: [2.9, 1, -0.16] },
  { id: "rear_right", label: "Rear right", side: -1, front: false, hinge: [-2.9, 1, -0.16] },
];
export const OPEN_ANGLE = Math.PI / 3;
export const WINDOW_DROP = 1.28;
export const WINDOW_INSET = 0.24;
export const WHEEL_RADIUS = 1.075;
export const WHEEL_ANGULAR_SPEED = 3;
export function wheelAngle(angle, delta) {
  // Forward is +Z: a +X axle rotation moves the contact patch toward -Z.
  return (angle + delta * WHEEL_ANGULAR_SPEED) % (Math.PI * 2);
}
export const LIDS = [
  { id: "hood", label: "Front hood", hinge: [0, 2.95, 4.55], angle: -Math.PI * 0.36 },
  { id: "trunk", label: "Rear trunk", hinge: [0, 3.1, -5.72], angle: Math.PI * 0.38 },
];
export const WHEELS = DOORS.map((door) => ({
  id: `wheel_${door.id}`,   hinge: [door.side * 2.55, 1.075, door.front ? 5.25 : -3.96],
}));
const WINDSHIELD_PROFILE = [[-1.83, 1.27], [1.83, 1.27], [2.17, 4.48], [-2.17, 4.48]];
const ROOF_APERTURE_HALF_WIDTH = 1.86;
function windshieldSidePlane(side) {
  const top = WINDSHIELD_PROFILE[1], bottom = WINDSHIELD_PROFILE[2];
  const slope = (bottom[0] - top[0]) / (bottom[1] - top[1]);
  return [side, 0, -slope, -top[0] + slope * top[1]];
}
function trunkSidePlane(side) {
  return [-side, .2, 0, 1.36];
}
function rearWindowFrontPlane() {
  const slope = .32 / .63;
  return [0, slope, 1, 3.05 - slope * 3.35];
}
function wheelRadialPlanes(wheel, radius, segments = 64) {
  return Array.from({ length: segments }, (_, i) => {
    const angle = i / segments * Math.PI * 2;
    const y = Math.cos(angle), z = Math.sin(angle);
    return [0, -y, -z, radius + y * wheel.hinge[1] + z * wheel.hinge[2]];
  });
}
export function wheelRimRegion(wheel) {
  return { planes: wheelRadialPlanes(wheel, .85 * Math.cos(Math.PI / 64)) };
}

// Counter-clockwise profile polygons, measured against the STL's existing seams.
function profilePlanes(points, horizontal = 2, vertical = 1) {
  let signedArea = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    signedArea += a[0] * b[1] - b[0] * a[1];
  }
  const direction = Math.sign(signedArea);
  return points.map((a, i) => {
    const b = points[(i + 1) % points.length];
    const nx = -(b[1] - a[1]) * direction, ny = (b[0] - a[0]) * direction;
    const plane = [0, 0, 0, -nx * a[0] - ny * a[1]];
    plane[horizontal] = nx;
    plane[vertical] = ny;
    return plane;
  });
}
export function doorPlanes(door) {
  // The upper door skins tuck inboard, especially at the rear beltline.
  return [[door.side, 0, 0, -1.95], ...profilePlanes(door.front
    ? [[0.015, 0.89], [3.55, 0.83], [3.57, 2.74], [3.37, 3.005], [-0.18, 3.145]]
    : [[-1.65, 0.92], [-0.045, 0.89], [-0.24, 3.15], [-3.5, 3.35], [-3.66, 3.02], [-2.09, 1.08]])];
}
export function windowPlanes(door) {
  return [door.front ? windshieldSidePlane(door.side) : rearWindowFrontPlane(), [door.side, 0.6, 0, -4.1],
    [-door.side, 0, 0, 2.69], windowSillPlane(door), ...profilePlanes(windowEnvelope(door))];
}
export function windowSillPlane(door) {
  return [0, 1, door.front ? .035 : .06, -3.15];
}
function windowEnvelope(door) {
  return door.front
    ? [[-.20, 2.98], [3.46, 2.98], [3.5, 3.10], [1.3, 4.30], [-.46, 4.30]]
    : [[-3.62, 3.10], [-.24, 3.10], [-.83, 4.30], [-1.9, 4.30], [-3.48, 3.98]];
}
export function beltPlanes(door) {
  return [...(door.front ? [windshieldSidePlane(door.side)] : []), [door.side, 0, 0, -1.85],
    windowSillPlane(door).map((value) => -value), ...profilePlanes(windowEnvelope(door))];
}
export function roundedProfile(points, iterations = 2) {
  let result = points;
  for (let pass = 0; pass < iterations; pass++) result = result.flatMap((a, i) => {
    const b = result[(i + 1) % result.length];
    return [[a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25],
      [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]];
  });
  return result;
}
export function profileRegion(points, side) {
  const contour = points.map(([x, y]) => new Vector2(x * side, y));
  const triangles = ShapeUtils.triangulateShape(contour, []);
  if (!triangles.length) throw new Error("A lamp profile could not be triangulated.");
  const xs = contour.map((point) => point.x), ys = contour.map((point) => point.y);
  return {
    planes: [[1, 0, 0, -Math.min(...xs)], [-1, 0, 0, Math.max(...xs)],
      [0, 1, 0, -Math.min(...ys)], [0, -1, 0, Math.max(...ys)]],
    sections: triangles.map((triangle) => profilePlanes(triangle.map((i) => [contour[i].x, contour[i].y]), 0, 1)),
  };
}
export function pillarProfile(pillar) {
  return {
    a: [[3.35, 3.0], [3.68, 3.0], [1.3, 4.31], [1.15, 4.31]],
    b: [[-.25, 3.15], [-.10, 3.15], [-.50, 4.28], [-.84, 4.28]],
    c: [[-3.2, 3.35], [-3.05, 3.35], [-3.37, 3.98], [-3.52, 3.98]],
  }[pillar];
}
export function frontRoofEdgeHeight(z) {
  const start = .8, end = 2.15, span = end - start;
  const roofSlope = -.125, pillarSlope = (3.0 - 4.31) / (3.35 - 1.15);
  const roofY = 4.275 + roofSlope * start;
  const pillarY = 3.0 + pillarSlope * (end - 3.35);
  if (z <= start) return 4.275 + roofSlope * z;
  if (z >= end) return 3.0 + pillarSlope * (z - 3.35);
  // Tangent-continuous blend follows the source's curved A/roof crease.
  const t = (z - start) / span, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * roofY + (t3 - 2 * t2 + t) * span * roofSlope
    + (-2 * t3 + 3 * t2) * pillarY + (t3 - t2) * span * pillarSlope;
}
function frontRoofRegion(side, seal = false) {
  const zs = [-.2, ...Array.from({ length: 33 }, (_, i) => .8 + i * (2.15 - .8) / 32)];
  const boundaryPlanes = [];
  const sections = zs.slice(1).map((z, i) => {
    const previous = zs[i], y = frontRoofEdgeHeight(previous);
    const slope = (frontRoofEdgeHeight(z) - y) / (z - previous);
    const edge = [0, 1, -slope, slope * previous - y];
    boundaryPlanes.push(edge);
    const lower = [...edge];
    if (seal) lower[3] += .03;
    return [lower, ...(seal ? [edge.map((value) => -value)] : []),
      [0, 0, 1, -previous], [0, 0, -1, z]];
  });
  return {
    planes: [[side, 0, 0, -1.65], windshieldSidePlane(side), [0, 0, 1, .2], [0, 0, -1, 2.15]],
    sections, boundaryPlanes,
  };
}
export function partRegions() {
  const regions = WHEELS.map((wheel) => ({
    id: wheel.id,
    // The source's inboard wheel skin reaches x=+/-1.928, behind the visible rim.
    planes: [[Math.sign(wheel.hinge[0]), 0, 0, -1.90], ...wheelRadialPlanes(wheel, 1.14)],
  }));
  for (const side of [-1, 1]) {
    const suffix = side > 0 ? "left" : "right";
    regions.push({
      id: `roof_paint_${suffix}`,
      planes: [[side, 0, 0, -1.65], windshieldSidePlane(side), [0, 1, 0, -4.30], [0, 0, 1, 3.1], [0, 0, -1, 1.6]],
    });
    regions.push({
      id: `roof_transition_${suffix}`,
      ...frontRoofRegion(side),
    });
    // Protect the actual structural strips before glass or moving trim can claim them.
    for (const pillar of ["a", "b", "c"]) regions.push({
      id: `pillar_${pillar}_${suffix}`,
      planes: [pillar === "a" ? windshieldSidePlane(side) : [side, 0, 0, -1.5], ...profilePlanes(pillarProfile(pillar))],
    });
  }
  for (const [end, minZ, maxZ] of [["front", 1.10, 1.34], ["rear", -1.25, -1.01]]) regions.push({
    id: `roof_header_${end}`,
    planes: [[1, 0, 0, ROOF_APERTURE_HALF_WIDTH], [-1, 0, 0, ROOF_APERTURE_HALF_WIDTH], [0, 1, 0, -4.16],
      [0, 0, 1, -minZ], [0, 0, -1, maxZ]],
  });
  for (const side of [-1, 1]) {
    const suffix = side > 0 ? "left" : "right";
    regions.push({ id: `roof_seal_front_${suffix}`, ...frontRoofRegion(side, true) });
    for (const [end, slope, level, minZ, maxZ] of [
      ["middle", 0, 4.30, -1.9, -.2],
      ["rear", .32 / 1.58, 4.30 + 1.9 * (.32 / 1.58), -3.48, -1.9],
    ]) regions.push({
      id: `roof_seal_${end}_${suffix}`,
      planes: [[side, 0, 0, -1.65], [0, 1, -slope, -level + .03],
        [0, -1, slope, level], [0, 0, 1, -minZ], [0, 0, -1, maxZ]],
    });
  }
  for (const side of [-1, 1]) regions.push({
    id: `quarter_glass_${side > 0 ? "left" : "right"}`,
    planes: [[side, .6, 0, -3.65]],
    sections: [
      profilePlanes([[-4.44, 3.69], [-3.2, 3.39], [-3.52, 3.89]]),
      [...profilePlanes(windowEnvelope({ front: false })), windowSillPlane({ front: false }),
        rearWindowFrontPlane().map((value) => -value)],
    ],
  });
  for (const door of DOORS) {
    if (door.front) regions.push({
      id: `mirror_${door.id}`,
      planes: [[door.side, 0, 0, -2.72], [0, 1, 0, -2.94], [0, -1, 0, 3.4], [0, 0, 1, -1.7], [0, 0, -1, 3.25]],
    });
    regions.push({ id: `window_${door.id}`, planes: windowPlanes(door) });
    regions.push({ id: door.id, planes: doorPlanes(door) });
    regions.push({ id: `belt_${door.id}`, planes: beltPlanes(door) });
  }
  for (const side of [-1, 1]) {
    const suffix = side > 0 ? "left" : "right";
    const head = profileRegion(roundedProfile([
      [2.587, 2.214], [2.557, 2.437], [2.46, 2.593], [2.326, 2.60], [2.132, 2.414],
      [1.976, 2.303], [1.685, 2.214], [1.461, 2.043], [1.61, 1.991], [2.244, 1.983], [2.527, 2.073],
    ]), side);
    regions.push({
      id: `head_lamp_${suffix}`, ...head,
      planes: [...head.planes, [side * .479, 1.464, 1, -10.713], [-side * .479, -1.464, -1, 11.153]],
    });
    const tail = profileRegion(roundedProfile([
      [1.245, 2.734], [1.335, 2.793], [1.484, 2.986], [1.99, 3.068],
      [2.259, 3.031], [2.386, 2.919], [2.445, 2.667], [1.752, 2.659],
    ]), side);
    const planes = [...tail.planes, [-side * .51, 0, 1, 7.73], [side * .51, 0, -1, -7.23]];
    regions.push({ id: `tail_lamp_inner_${suffix}`, ...tail, planes: [...planes, trunkSidePlane(side)] });
    regions.push({ id: `tail_lamp_outer_${suffix}`, ...tail, planes });
  }
  regions.push(
    { id: "hood", planes: [[0, 1, 0, -2.22], ...profilePlanes([
      [-2.24, 4.57], [2.24, 4.57], [2.39, 5.5], [1.98, 7.13], [-1.98, 7.13], [-2.39, 5.5],
    ], 0, 2)] },
    { id: "trunk", planes: [[0, 1, 0, -2.65], trunkSidePlane(1), trunkSidePlane(-1), ...profilePlanes([
      [-1.5, -7.03], [1.5, -7.03], [2.46, -6.35], [2.18, -5.78], [-2.18, -5.78], [-2.46, -6.35],
    ], 0, 2)] },
    { id: "windshield", planes: [[0, 1, 0, -3.035], ...profilePlanes(WINDSHIELD_PROFILE, 0, 2)] },
    { id: "roof_glass", planes: [[0, 1, 0, -4.25], [0, 0, 1, 1.15], [0, 0, -1, 1.30],
      [1, 0, 0, ROOF_APERTURE_HALF_WIDTH], [-1, 0, 0, ROOF_APERTURE_HALF_WIDTH]] },
    { id: "rear_glass", planes: [[0, 1, 0, -2.95], ...profilePlanes([
      [-0.85, -5.85], [0.85, -5.85], [1.52, -5.25], [1.73, -1.13], [-1.73, -1.13], [-1.52, -5.25],
    ], 0, 2)] },
  );
  return regions;
}

function split(polygon, plane) {
  const inside = [], outside = [];
  const distance = (point) => plane[0] * point[0] + plane[1] * point[1] + plane[2] * point[2] + plane[3];
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length];
    const da = distance(a), db = distance(b);
    (da >= 0 ? inside : outside).push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      const intersection = a.map((value, axis) => value + t * (b[axis] - value));
      inside.push(intersection);
      outside.push(intersection);
    }
  }
  return [inside, outside];
}

function triangulate(polygon, output) {
  for (let index = 1; index < polygon.length - 1; index++) {
    output.push(...polygon[0], ...polygon[index], ...polygon[index + 1]);
  }
}
function clipConvex(polygon, planes) {
  if (planes.some(([x, y, z, w]) => polygon.every((p) => x * p[0] + y * p[1] + z * p[2] + w < 0))) {
    return { inside: [], outside: [polygon] };
  }
  let candidate = polygon;
  const outside = [];
  for (const plane of planes) {
    if (candidate.length < 3) break;
    const [inside, rejected] = split(candidate, plane);
    if (rejected.length >= 3) outside.push(rejected);
    candidate = inside;
  }
  return { inside: candidate, outside };
}
function partitionPolygons(polygons, { planes, sections }) {
  const inside = [], outside = [];
  for (const polygon of polygons) {
    const clipped = clipConvex(polygon, planes);
    outside.push(...clipped.outside);
    if (clipped.inside.length < 3) continue;
    if (!sections) { inside.push(clipped.inside); continue; }
    let remaining = [clipped.inside];
    for (const section of sections) {
      const next = [];
      for (const candidate of remaining) {
        const fragment = clipConvex(candidate, section);
        if (fragment.inside.length >= 3) inside.push(fragment.inside);
        next.push(...fragment.outside);
      }
      remaining = next;
    }
    outside.push(...remaining);
  }
  return { inside, outside };
}
export function clipSurface(positions, region) {
  const result = [];
  for (let i = 0; i < positions.length; i += 9) {
    const triangle = [0, 3, 6].map((offset) => Array.from(positions.subarray(i + offset, i + offset + 3)));
    for (const polygon of partitionPolygons([triangle], region).inside) triangulate(polygon, result);
  }
  return new Float32Array(result);
}

export function partitionVehicle(positions) {
  const body = [], regions = partRegions();
  const parts = Object.fromEntries(regions.map(({ id }) => [id, []]));
  for (let offset = 0; offset < positions.length; offset += 9) {
    let remaining = [[
      Array.from(positions.subarray(offset, offset + 3)),
      Array.from(positions.subarray(offset + 3, offset + 6)),
      Array.from(positions.subarray(offset + 6, offset + 9)),
    ]];
    for (const region of regions) {
      const clipped = partitionPolygons(remaining, region);
      for (const polygon of clipped.inside) triangulate(polygon, parts[region.id]);
      remaining = clipped.outside;
    }
    for (const polygon of remaining) triangulate(polygon, body);
  }
  return {
    body: new Float32Array(body),
    ...Object.fromEntries(Object.entries(parts).map(([id, vertices]) => [id, new Float32Array(vertices)])),
  };
}
