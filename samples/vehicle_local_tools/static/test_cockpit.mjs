import assert from "node:assert/strict";
import test from "node:test";
import { AutopilotSimulator } from "./autopilot-sim.mjs";
import { createDemoTrack, LocalMediaPlayer } from "./media-player.mjs";

function active() {
  const sim = new AutopilotSimulator();
  sim.setConditions({ connected: true });
  sim.command({ action: "engage" });
  return sim;
}
test("EPA keeps running across assistance interlocks without automatically engaging", () => {
  const sim = new AutopilotSimulator();
  assert.equal(sim.state.running, true);
  assert.equal(sim.state.mode, "disengaged");
  assert.throws(() => sim.command({ action: "engage" }));
  sim.advance(1, { speedKmh: 20, distanceM: 10 });
  assert.equal(sim.state.actual_speed_kmh, 20);
  sim.setConditions({ connected: true });
  sim.command({ action: "engage" });
  sim.advance(3);
  assert(sim.state.actual_speed_kmh > 0);
  let distanceM = 10;
  for (const condition of [{ visible: false }, { connected: false }, { bodyReady: false }]) {
    sim.setConditions(condition);
    assert.equal(sim.state.mode, "disengaged");
    assert.equal(sim.state.running, true);
    const before = sim.state.distance_m;
    sim.advance(1, { speedKmh: 30, distanceM: distanceM += 10 });
    assert.equal(sim.state.distance_m, before + 10);
    assert.equal(sim.state.actual_speed_kmh, 30);
    sim.setConditions({ visible: true, connected: true, bodyReady: true });
    assert.equal(sim.state.mode, "disengaged");
  }
});
test("direct engagement takes over EPA speed and disengagement returns without a distance jump", () => {
  const sim = new AutopilotSimulator();
  sim.setConditions({ connected: true });
  sim.advance(.1, { speedKmh: 10, distanceM: 20 });
  sim.advance(.1, { speedKmh: 12, distanceM: 21 });
  const before = sim.state.distance_m;
  sim.command({ action: "engage", target_speed_kmh: 60 });
  assert.equal(sim.state.distance_m, before);
  assert.equal(sim.state.actual_speed_kmh, 12);
  sim.advance(1, { speedKmh: 15, distanceM: 24 });
  assert(sim.state.actual_speed_kmh > 15);
  const assistedDistance = sim.state.distance_m;
  sim.command({ action: "disengage" });
  assert.equal(sim.state.actual_speed_kmh, 15);
  assert.equal(sim.state.distance_m, assistedDistance);
  sim.advance(.1, { speedKmh: 17, distanceM: 25 });
  assert.equal(sim.state.actual_speed_kmh, 17);
  assert.equal(sim.state.distance_m, assistedDistance + 1);
});
test("fixed stepping is deterministic across render frame partitions", () => {
  const a = active(), b = active();
  for (let i = 0; i < 100; i++) a.advance(.1);
  for (let i = 0; i < 500; i++) b.advance(.02);
  assert.deepEqual(a.snapshot(), b.snapshot());
  const copy = a.snapshot(); copy.mode = "fault";
  assert.equal(a.state.mode, "active");
});
test("invalid patches do not mutate simulator state", () => {
  const sim = active(), before = sim.snapshot();
  for (const args of [
    { action: "update", target_speed_kmh: 121 }, { action: "update", following_gap: 0 },
    { action: "update", target_speed_kmh: 80, following_gap: 1.5 },
    { action: "update", lane_keeping: 1 }, { action: "resume", target_speed_kmh: 40 },
    { action: "update", target_speed_kmh: NaN }, { action: "tesla_api" }, { action: "update" },
  ]) {
    assert.throws(() => sim.command(args));
    assert.deepEqual(sim.snapshot(), before);
  }
  assert.throws(() => sim.command({ action: "pause" }, -1));
  assert.deepEqual(sim.snapshot(), before);
});
test("takeover keeps EPA playing but requires manual acknowledgement before re-engagement", () => {
  for (const scenario of ["lane_loss", "obstacle"]) {
    const sim = active();
    sim.scenario(scenario); sim.advance(.02);
    assert.equal(sim.state.mode, "takeover_required");
    assert.equal(sim.state.running, true);
    assert.throws(() => sim.command({ action: "engage" }));
    assert.throws(() => sim.acknowledge());
    sim.command({ action: "disengage" });
    assert.equal(sim.state.mode, "takeover_required");
    sim.scenario("clear"); sim.acknowledge();
    assert.equal(sim.state.running, true);
    assert.equal(sim.state.mode, "disengaged");
    sim.command({ action: "engage" });
    assert.equal(sim.state.mode, "active");
  }
});
test("slowing lead car changes speed without collision or external services", () => {
  const sim = active();
  sim.command({ action: "update", target_speed_kmh: 100 });
  sim.scenario("slowing_lead");
  for (let i = 0; i < 1800; i++) sim.advance(.02);
  assert(sim.state.lead_distance_m >= 5);
  assert(sim.state.actual_speed_kmh <= 25);
});
test("original demo track is an audible, click-free 20-second PCM WAV under 1 MiB", async () => {
  const track = createDemoTrack();
  assert.equal(track.type, "audio/wav");
  assert.ok(track.size < 1024 * 1024);
  const buffer = await track.arrayBuffer(), wav = new DataView(buffer);
  assert.equal(new TextDecoder().decode(buffer.slice(0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(buffer.slice(8, 12)), "WAVE");
  assert.equal(wav.getUint16(20, true), 1);
  assert.equal(wav.getUint16(22, true), 1);
  assert.equal(wav.getUint32(24, true), 24000);
  assert.equal(wav.getUint16(34, true), 16);
  assert.equal((buffer.byteLength - 44) / 2 / 24000, 20);
  assert.equal(wav.getUint32(40, true), buffer.byteLength - 44);
  let peak = 0, energy = 0;
  for (let offset = 44; offset < buffer.byteLength; offset += 2) {
    const value = wav.getInt16(offset, true) / 32767;
    peak = Math.max(peak, Math.abs(value));
    energy += value * value;
  }
  assert.ok(peak >= .7 && peak <= .73);
  assert.ok(Math.sqrt(energy / ((buffer.byteLength - 44) / 2)) > .1);
  assert.equal(wav.getInt16(44, true), 0);
  assert.equal(wav.getInt16(buffer.byteLength - 2, true), 0);
});
test("media source selection does not autoplay and disables looping for uploaded files", () => {
  const audio = { volume: 0, paused: true, pause() { this.paused = true; }, load() {} };
  const player = new LocalMediaPlayer(audio), track = new Blob(["audio"], { type: "audio/wav" });
  try {
    player.select(track, true);
    assert.equal(audio.loop, true);
    assert.equal(audio.paused, true);
    player.select(track);
    assert.equal(audio.loop, false);
    assert.equal(audio.paused, true);
  } finally { URL.revokeObjectURL(player.url); }
});
test("media requires a ready source and acknowledges only resolved playback", async () => {
  let resolvePlay, rejectPlay;
  const audio = {
    volume: 0, muted: false, paused: true, ended: false, readyState: 1, currentTime: 0, duration: 20,
    pause() { this.paused = true; }, load() {}, removeAttribute() {},
    play() { return new Promise((resolve, reject) => { resolvePlay = () => { this.paused = false; resolve(); }; rejectPlay = reject; }); },
  };
  const player = new LocalMediaPlayer(audio);
  await assert.rejects(player.command({ action: "play" }));
  player.url = "blob:test";
  let completed = false;
  const pending = player.command({ action: "play" }).then((value) => { completed = true; return value; });
  await Promise.resolve();
  assert.equal(completed, false);
  resolvePlay();
  assert.equal((await pending).playing, true);
  const failed = player.command({ action: "play" });
  rejectPlay(new Error("Playback blocked"));
  await assert.rejects(failed, /blocked/);
  await assert.rejects(player.command({ action: "seek", position_seconds: 21 }));
  player.setVolume(60);
  assert.equal(audio.volume, .6);
  assert.throws(() => player.setVolume(61));
  assert.equal((await player.command({ action: "mute" })).muted, true);
  assert.equal((await player.command({ action: "pause" })).playing, false);
});
