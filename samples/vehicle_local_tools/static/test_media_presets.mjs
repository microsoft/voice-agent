import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { DEMO_TRACKS, LocalMediaPlayer, createDemoTrack } from "./media-player.mjs";

test("pending preset playback never publishes playing before audio metadata is available", () => {
  const audio = { readyState: 0, paused: false, ended: false, muted: false, error: null, currentTime: 0, duration: NaN };
  const player = new LocalMediaPlayer(audio);
  player.url = "blob:pending-preset";
  assert.deepEqual(player.snapshot(), {
    available: false, playing: false, muted: false, position_seconds: 0, duration_seconds: 0,
  });
  audio.readyState = 1;
  audio.duration = 20;
  assert.equal(player.snapshot().playing, true);
  audio.error = new Error("Decode failed");
  assert.equal(player.snapshot().playing, false);
});

test("four original presets have unique names, identities and audible, finite WAV waveforms", async () => {
  assert.equal(DEMO_TRACKS.length, 4);
  assert.equal(new Set(DEMO_TRACKS.map((track) => track.id)).size, 4);
  assert.equal(new Set(DEMO_TRACKS.map((track) => track.title)).size, 4);
  const hashes = new Set();
  for (const track of DEMO_TRACKS) {
    const blob = createDemoTrack(track.id);
    assert.equal(blob.type, "audio/wav");
    assert.ok(blob.size < 1024 * 1024);
    const buffer = await blob.arrayBuffer(), wav = new DataView(buffer);
    assert.equal(wav.getUint32(24, true), 24000);
    assert.equal((buffer.byteLength - 44) / 2 / 24000, 20);
    assert.equal(wav.getInt16(44, true), 0);
    assert.equal(wav.getInt16(buffer.byteLength - 2, true), 0);
    let peak = 0, energy = 0;
    for (let offset = 44; offset < buffer.byteLength; offset += 2) {
      const value = wav.getInt16(offset, true) / 32767;
      peak = Math.max(peak, Math.abs(value)); energy += value * value;
    }
    assert.ok(peak >= .7 && peak <= .73);
    assert.ok(Math.sqrt(energy / ((buffer.byteLength - 44) / 2)) > .1);
    hashes.add(createHash("sha256").update(new Uint8Array(buffer)).digest("hex"));
  }
  assert.equal(hashes.size, 4);
});

test("default preset stays compatible and unknown presets fail explicitly", async () => {
  assert.deepEqual(await createDemoTrack().arrayBuffer(), await createDemoTrack("evening").arrayBuffer());
  assert.throws(() => createDemoTrack("missing"), /Unknown AURA music preset/);
});
