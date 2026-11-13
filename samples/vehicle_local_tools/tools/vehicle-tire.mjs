import { LatheGeometry, Vector2 } from "three";
import { WHEEL_RADIUS } from "../static/car-model.mjs";

// Closed bead-to-bead profile: the original STL tire was cut through its inboard wall.
export function tireGeometry() {
  const profile = [
    [.83, -.28], [.89, -.32], [1.0, -.29], [WHEEL_RADIUS, -.22],
    [WHEEL_RADIUS, -.13], [WHEEL_RADIUS - .015, -.11], [WHEEL_RADIUS - .015, -.08],
    [WHEEL_RADIUS, -.06], [WHEEL_RADIUS, .06], [WHEEL_RADIUS - .015, .08],
    [WHEEL_RADIUS - .015, .11], [WHEEL_RADIUS, .13],
    [WHEEL_RADIUS, .22], [1.0, .29], [.89, .32], [.83, .28], [.83, -.28],
  ].map(([radius, axle]) => new Vector2(radius, axle));
  const geometry = new LatheGeometry(profile, 128);
  geometry.rotateZ(-Math.PI / 2);
  return geometry.toNonIndexed();
}
