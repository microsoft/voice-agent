export const DEMO_TRACKS = Object.freeze([
  { id: "evening", title: "Evening Drive", beat: .625, chords: [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 69]], pattern: [0, 2, 1, 3, 2, 1, 3, 2], harmonic: .2 },
  { id: "city", title: "City Lights", beat: .4166667, chords: [[62, 65, 69, 72], [58, 62, 65, 69], [65, 69, 72, 76], [60, 64, 67, 70]], pattern: [0, 1, 2, 3, 2, 3, 1, 2], harmonic: .45 },
  { id: "horizon", title: "Quiet Horizon", beat: 1.25, chords: [[55, 59, 62, 66], [52, 55, 59, 62], [48, 52, 55, 59], [50, 54, 57, 62]], pattern: [0, 2, 3, 1], harmonic: .05 },
  { id: "coast", title: "Coastal Breeze", beat: .5, chords: [[65, 69, 72, 76], [62, 65, 69, 72], [58, 62, 65, 69], [60, 64, 67, 72]], pattern: [3, 1, 2, 0, 2, 1, 0, 2], harmonic: .3 },
]);

export function createDemoTrack(id = "evening") {
  const track = DEMO_TRACKS.find((item) => item.id === id);
  if (!track) throw new Error("Unknown AURA music preset.");
  const sampleRate = 24000, duration = 20, beatSeconds = track.beat, chordSeconds = 5;
  const { chords, pattern } = track;
  const frequency = (note) => 440 * 2 ** ((note - 69) / 12);
  const voices = chords.map((chord) => ({
    pad: chord.map(frequency), bass: frequency(chord[0] - 24),
    melody: pattern.map((index) => frequency(chord[index] + 12)),
  }));
  const samples = new Float32Array(sampleRate * duration);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const time = i / sampleRate, voice = voices[Math.floor(time / chordSeconds)];
    const chordTime = time % chordSeconds, beatTime = time % beatSeconds;
    const phase = 2 * Math.PI * time;
    const padEnvelope = Math.min(1, chordTime / .08, (chordSeconds - chordTime) / .15);
    const noteEnvelope = (1 - Math.exp(-beatTime * 80)) * Math.exp(-beatTime * 4) * Math.min(1, (beatSeconds - beatTime) / .04);
    const melody = voice.melody[Math.floor(chordTime / beatSeconds) % pattern.length];
    const pad = voice.pad.reduce((sum, pitch) => sum + Math.sin(phase * pitch), 0) * .025;
    const note = Math.sin(phase * melody) + track.harmonic * Math.sin(phase * melody * 2);
    const fade = Math.min(1, time / .25, (duration - 1 / sampleRate - time) / .4);
    samples[i] = ((pad + .07 * Math.sin(phase * voice.bass)) * padEnvelope + .12 * note * noteEnvelope) * fade;
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  const buffer = new ArrayBuffer(44 + samples.length * 2), wav = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((character, index) => wav.setUint8(offset + index, character.charCodeAt(0)));
  text(0, "RIFF"); wav.setUint32(4, buffer.byteLength - 8, true); text(8, "WAVE");
  text(12, "fmt "); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true);
  wav.setUint16(22, 1, true); wav.setUint32(24, sampleRate, true); wav.setUint32(28, sampleRate * 2, true);
  wav.setUint16(32, 2, true); wav.setUint16(34, 16, true);
  text(36, "data"); wav.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) wav.setInt16(44 + i * 2, Math.round(samples[i] / peak * .72 * 32767), true);
  return new Blob([buffer], { type: "audio/wav" });
}

export class LocalMediaPlayer {
  constructor(audio, volume = 20) {
    this.audio = audio;
    this.url = null;
    this.volume = volume;
    this.audio.volume = volume / 100;
  }
  select(file, loop = false) {
    if (!file || !file.type.startsWith("audio/")) throw new Error("Choose a supported local audio file.");
    if (this.url) URL.revokeObjectURL(this.url);
    this.audio.pause();
    this.url = URL.createObjectURL(file);
    this.audio.src = this.url;
    this.audio.loop = loop;
    this.audio.load();
  }
  setVolume(value) {
    if (!Number.isInteger(value) || value < 0 || value > 60) throw new Error("Invalid media volume.");
    this.volume = value;
    this.audio.volume = value / 100;
  }
  snapshot() {
    const available = Boolean(this.url && this.audio.readyState >= 1 && !this.audio.error);
    return {
      available,
      playing: available && !this.audio.paused && !this.audio.ended, muted: this.audio.muted,
      position_seconds: Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0,
      duration_seconds: Number.isFinite(this.audio.duration) ? this.audio.duration : 0,
    };
  }
  async command(args) {
    if (!this.snapshot().available) throw new Error("Audio is not ready. Load the demo track or choose a supported local audio file.");
    if (!["play", "pause", "seek", "mute", "unmute"].includes(args.action)
      || Object.keys(args).some((key) => !["action", "position_seconds"].includes(key))
      || ("position_seconds" in args) !== (args.action === "seek")) throw new Error("Invalid media command.");
    if (args.action === "play") await this.audio.play();
    if (args.action === "pause") this.audio.pause();
    if (args.action === "mute") this.audio.muted = true;
    if (args.action === "unmute") this.audio.muted = false;
    if (args.action === "seek") {
      const value = args.position_seconds;
      if (!Number.isFinite(value) || value < 0 || value > this.audio.duration) throw new Error("Seek must be within the selected file.");
      await new Promise((resolve, reject) => {
        if (Math.abs(this.audio.currentTime - value) < .01) { resolve(); return; }
        const cleanup = () => { clearTimeout(timer); this.audio.removeEventListener("seeked", done); this.audio.removeEventListener("error", fail); };
        const done = () => { cleanup(); resolve(); };
        const fail = () => { cleanup(); reject(new Error("Local audio seek failed.")); };
        const timer = setTimeout(fail, 2000);
        this.audio.addEventListener("seeked", done, { once: true });
        this.audio.addEventListener("error", fail, { once: true });
        this.audio.currentTime = value;
      });
    }
    return this.snapshot();
  }
  close() {
    this.audio.pause();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.audio.removeAttribute("src");
    this.audio.load();
  }
}
