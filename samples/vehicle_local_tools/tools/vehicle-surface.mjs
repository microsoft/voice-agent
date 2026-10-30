export function cleanSurface(positions) {
  const result = [];
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i + 3] - positions[i], ay = positions[i + 4] - positions[i + 1], az = positions[i + 5] - positions[i + 2];
    const bx = positions[i + 6] - positions[i], by = positions[i + 7] - positions[i + 1], bz = positions[i + 8] - positions[i + 2];
    if (Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) / 2 <= 1e-10) continue;
    result.push(...positions.subarray(i, i + 9));
  }
  return new Float32Array(result);
}

export function lining(positions, side, cutPlanes) {
  const back = [], boundaries = new Map();
  const key = (point) => point.map((value) => Math.round(value * 10000)).join(",");
  for (let i = 0; i < positions.length; i += 9) {
    const triangle = [0, 3, 6].map((offset) => Array.from(positions.subarray(i + offset, i + offset + 3)));
    for (const point of [triangle[0], triangle[2], triangle[1]]) back.push(point[0] - side * .075, point[1], point[2]);
    for (let j = 0; j < 3; j++) {
      const a = triangle[j], b = triangle[(j + 1) % 3], edge = [key(a), key(b)].sort().join("/");
      const found = boundaries.get(edge);
      if (found) found.count++;
      else boundaries.set(edge, { a, b, count: 1 });
    }
  }
  for (const { a, b, count } of boundaries.values()) {
    if (count !== 1 || Math.hypot(...a.map((value, axis) => value - b[axis])) < 1e-4) continue;
    // Only real partition cuts need walls; open STL seams must not grow black fins.
    if (!cutPlanes.some((plane) => [a, b].every((point) =>
      Math.abs(plane[0] * point[0] + plane[1] * point[1] + plane[2] * point[2] + plane[3]) /
        Math.hypot(...plane.slice(0, 3)) < 2e-5))) continue;
    const c = [b[0] - side * .075, b[1], b[2]], d = [a[0] - side * .075, a[1], a[2]];
    back.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  return cleanSurface(new Float32Array(back));
}
