// Run in a freshly loaded isolated cockpit; advance only its local EPA clock.
(async () => {
  const driving = await import("/static/drive-cycle.mjs");
  const host = document.getElementById("car-view");
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const waitFor = async (predicate) => {
    for (let i = 0; i < 200; i++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Traffic regression condition timed out.");
  };
  await waitFor(() => host.dataset.trafficZ && driving.driveClock);
  const { driveClock } = driving;
  const now = performance.now(), current = driveClock.sample(now).cycleSeconds;
  const idle = driveClock.cycle.speeds.findIndex((speed, index, speeds) =>
    index > current + 2 && index + 5 < speeds.length && speed === 0 &&
    speeds.slice(index, index + 5).every((value) => value === 0));
  assert(idle >= 0, "Use a fresh cockpit with an upcoming EPA idle segment.");
  driveClock.startedAt = now - (idle + .25) * 1000;
  await waitFor(() => host.dataset.speedKmh === "0.0000" && host.dataset.motionSource === "reference");
  const before = { ...host.dataset };
  await new Promise((resolve) => setTimeout(resolve, 400));
  const after = { ...host.dataset };
  assert(after.speedKmh === "0.0000", "Actual EPA speed remains zero");
  assert(after.distanceM === before.distanceM, "Ego distance stays fixed during EPA idle");
  assert(after.roadPhase === before.roadPhase, "Road markings stay fixed");
  assert(after.wheel_front_left === before.wheel_front_left && after.wheelsRolling === "false", "Ego wheels stay stopped");
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    assert(after.trafficZ === before.trafficZ && after.trafficSeconds === before.trafficSeconds, "Reduced motion freezes all surrounding traffic");
  } else {
    const positions = before.trafficZ.split(",");
    assert(after.trafficZ.split(",").every((value, index) => value !== positions[index]), "Both cars, bicycle and pedestrian move while ego is stopped");
    assert(Number(after.trafficSeconds) > Number(before.trafficSeconds), "Traffic uses an independent visible-time clock");
  }
  return { passed: true, idleSecond: idle, reducedMotion: after.motionReduced, egoSpeed: after.speedKmh,
    before: before.trafficZ, after: after.trafficZ };
})();
