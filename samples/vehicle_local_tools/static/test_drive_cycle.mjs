import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FTP75Cycle, DriveClock, MPH_TO_KMH, WHEEL_RADIUS_M, wheelAngleForDistance, initializeDriveCycle, driveClock } from "./drive-cycle.mjs";
import { AutopilotSimulator } from "./autopilot-sim.mjs";

const trace = readFileSync(new URL("./ftp75.txt", import.meta.url), "ascii");
const cycle = new FTP75Cycle(trace);
const near = (actual, expected, tolerance = 1e-8) => assert.ok(
  Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`,
);

test("official 1874-second FTP-75 trace, units and linear interpolation", () => {
  assert.equal(cycle.duration, 1874);
  assert.equal(cycle.speeds.length, 1875);
  near(Math.max(...cycle.speeds), 56.7 * MPH_TO_KMH);
  assert.equal(cycle.sample(20).speedKmh, 0);
  near(cycle.sample(21).speedKmh, 3 * MPH_TO_KMH);
  near(cycle.sample(21.5).speedKmh, 4.45 * MPH_TO_KMH);
  near(cycle.sample(22).speedKmh, 5.9 * MPH_TO_KMH);
  assert.equal(cycle.sample(1874).speedKmh, 0);
});

test("distance integrates the piecewise-linear speed exactly and stays continuous across loops", () => {
  near(cycle.sample(21).distanceM, 1.5 * .44704);
  near(cycle.sample(21.5).distanceM, (1.5 + 3 * .5 + 2.9 * .5 ** 2 / 2) * .44704);
  const total = cycle.sample(1874).distanceM;
  assert.ok(total > 17500 && total < 18000, "FTP-75 travels about 11.04 miles");
  near(cycle.sample(1874 + 22).distanceM, total + cycle.sample(22).distanceM);
  near(cycle.sample(1874 - .001).distanceM, total, 1e-5);
  near(cycle.sample(1874 * 4 + 21.5).distanceM, 4 * total + cycle.sample(21.5).distanceM);
});

test("wheel travel equals v/r at every trace segment, including idle and deceleration", () => {
  const dt = .01;
  for (let t = .25; t < cycle.duration; t += 1) {
    const a = cycle.sample(t), b = cycle.sample(t + dt);
    const angle = (b.distanceM - a.distanceM) / WHEEL_RADIUS_M;
    near(angle, ((a.speedKmh + b.speedKmh) / 7.2) * dt / WHEEL_RADIUS_M);
    const wrappedDelta = (wheelAngleForDistance(b.distanceM) - wheelAngleForDistance(a.distanceM) + 2 * Math.PI) % (2 * Math.PI);
    near(wrappedDelta, angle);
    assert.ok(angle >= 0, "forward +X axle rotation on both sides");
  }
  near(wheelAngleForDistance(2 * Math.PI * WHEEL_RADIUS_M), 0);
});

test("frame rate and background-tab gaps do not change sampled speed or wheel phase", () => {
  for (const fps of [30, 60, 144]) {
    const clock = new DriveClock(cycle, 1000);
    for (let frame = 0; frame < fps * 22; frame++) clock.sample(1000 + frame * 1000 / fps);
    near(clock.sample(23000).distanceM, cycle.sample(22).distanceM);
    near(clock.sample(23000).speedKmh, cycle.sample(22).speedKmh);
    near(clock.sample(23000 + 1874000).distanceM, cycle.sample(1896).distanceM);
  }
});

test("simulation starts automatically at idle and has no agent state or control dependency", () => {
  const clock = new DriveClock(cycle, 1000);
  assert.equal(clock.sample(1000).cycleSeconds, 0);
  assert.equal(clock.sample(21000).speedKmh, 0);
  near(clock.sample(22500).speedKmh, cycle.sample(21.5).speedKmh);
  near(clock.sample(23000).distanceM, cycle.sample(22).distanceM);
  assert.equal(typeof clock.sync, "undefined");
});
test("cockpit autoplays from the first moving EPA sample and loops the complete official trace", () => {
  initializeDriveCycle(trace, 1000);
  assert.equal(driveClock.sample(1000).cycleSeconds, 21);
  near(driveClock.sample(1000).speedKmh, cycle.sample(21).speedKmh);
  const sim = new AutopilotSimulator();
  const initial = driveClock.sample(1000);
  sim.advance(0, initial);
  for (const seconds of [1, 30, 1874, 1875, 1874 * 4]) {
    const sample = driveClock.sample(1000 + seconds * 1000);
    sim.advance(0, sample);
    near(sim.state.actual_speed_kmh, sample.speedKmh);
    near(sim.state.distance_m, sample.distanceM - initial.distanceM);
    assert.equal(sim.state.running, true);
  }
  const before = sim.snapshot();
  for (const sample of [{ speedKmh: NaN, distanceM: 100 }, { speedKmh: 3, distanceM: 0 }]) {
    assert.throws(() => sim.advance(.1, sample), /EPA/);
    assert.deepEqual(sim.snapshot(), before);
  }
});

test("invalid or incomplete traces and invalid clock states fail explicitly", () => {
  for (const text of ["", trace.replace("21\t3", "21\tNaN"), trace.split("\n").slice(0, 100).join("\n")]) {
    assert.throws(() => new FTP75Cycle(text));
  }
  for (const time of [-1, NaN, Infinity]) assert.throws(() => cycle.sample(time));
  for (const time of [NaN, Infinity]) assert.throws(() => new DriveClock(cycle, time));
  const clock = new DriveClock(cycle, 0);
  for (const time of [NaN, Infinity]) assert.throws(() => clock.sample(time));
});
