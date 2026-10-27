// Click the media heading first to provide real browser activation.
(async () => {
  const { command } = await import("/static/cockpit.js");
  const $ = (id) => document.getElementById(id);
  const audio = $("local-audio");
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const waitFor = async (predicate) => {
    for (let i = 0; i < 150; i++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Media browser condition timed out.");
  };
  const execute = async (args) => {
    const packet = await command("control_media", args);
    assert(packet.result.ok, JSON.stringify(packet.result));
  };
  await waitFor(() => $("control-status").textContent === "Controls connected" && audio.readyState >= 1);
  assert(navigator.userActivation.hasBeenActive, "Real browser activation");
  assert(audio.paused && audio.currentTime === 0, "Default source never autoplays");
  assert(audio.loop && Math.abs(audio.duration - 20) < .01, "Built-in loop has actual decoded metadata");
  assert($("media-track").textContent === "Evening Drive" && !$("media-play").disabled, "Default track is ready to play");
  const panel = document.querySelector(".media-card");
  assert($("media-title").textContent === "Music", "Simple music heading");
  assert(document.querySelector(".media-now-playing #media-play"), "Playback sits beside track metadata");
  assert($("media-demo").textContent === "AURA original", "Original source has a clear label");
  assert($("media-file").getAttribute("aria-label") === "Open audio file", "File chooser has an accessible name");
  assert($("media-availability").getAttribute("role") === "status", "Playback status is accessible");
  assert(document.documentElement.scrollWidth <= innerWidth, "Music panel does not cause page overflow");
  if (innerWidth > 1100 && innerHeight >= 720) {
    assert(panel.scrollHeight <= panel.clientHeight + 2, "Entire music player fits the desktop card");
  }
  const context = new AudioContext();
  const source = context.createMediaElementSource(audio), analyser = context.createAnalyser();
  source.connect(analyser); analyser.connect(context.destination);
  try {
    await context.resume();
    $("media-play").click();
    await waitFor(() => !audio.paused && audio.currentTime > .2);
    assert(panel.dataset.playing === "true" && !$("media-pause").hidden && $("media-play").hidden, "Playing state updates status and transport");
    await waitFor(() => parseFloat($("media-position").style.getPropertyValue("--played")) > 0);
    const waveform = new Float32Array(analyser.fftSize);
    await waitFor(() => {
      analyser.getFloatTimeDomainData(waveform);
      return waveform.some((sample) => Math.abs(sample) > .001);
    });
    assert(!audio.muted && audio.volume > 0, "Music is not muted or zero-volume");
    await execute({ action: "mute" });
    assert(audio.muted, "Real mute");
    await execute({ action: "unmute" });
    assert(!audio.muted, "Real unmute");
    await execute({ action: "seek", position_seconds: 19.8 });
    await waitFor(() => audio.currentTime < 1);
    assert(!audio.paused && !audio.ended, "Native audio loops instead of stopping at the end");
    await execute({ action: "pause" });
    const position = audio.currentTime;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert(audio.paused && audio.currentTime === position, "Pause stops playback");
    assert(panel.dataset.playing === "false" && !$("media-play").hidden, "Pause restores play control");
    const { createDemoTrack } = await import("/static/media-player.mjs");
    const files = new DataTransfer();
    files.items.add(new File([createDemoTrack()], "local-playback-test.wav", { type: "audio/wav" }));
    $("media-file").files = files.files;
    $("media-file").dispatchEvent(new Event("change"));
    await waitFor(() => audio.readyState >= 1);
    assert(!audio.loop && audio.paused && $("media-demo").getAttribute("aria-pressed") === "false", "Local file replaces the default without looping or autoplay");
    assert($("media-track").textContent === "local-playback-test.wav", "Local filename is shown safely as text");
    await execute({ action: "play" });
    await waitFor(() => audio.currentTime > .1);
    $("media-demo").click();
    await waitFor(() => audio.readyState >= 1 && audio.currentTime === 0);
    assert(audio.loop && audio.paused && $("media-file").value === "", "Demo restores the built-in source and pauses prior playback");
    await execute({ action: "seek", position_seconds: 2 });
    assert(Math.abs(audio.currentTime - 2) < .01, "Restored source supports confirmed seek");
    return "PASS: default no-autoplay, decoded 20s track, actual non-silent audio output, UI Play, control receipts, mute/unmute, native loop, pause/seek, local file override and Demo restoration";
  } finally {
    audio.pause();
    source.disconnect(); analyser.disconnect();
    await context.close();
  }
})();
