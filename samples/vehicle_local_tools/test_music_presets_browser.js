// Run after a user gesture in a loaded cockpit page with agent-browser eval --stdin.
(async () => {
  const { DEMO_TRACKS } = await import("/static/media-player.mjs");
  const { t, setLanguage } = await import("/static/i18n.mjs");
  const $ = (id) => document.getElementById(id);
  const audio = $("local-audio");
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const waitFor = async (predicate) => {
    for (let i = 0; i < 100; i++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Music preset check timed out.");
  };
  await waitFor(() => !$("media-play").disabled);
  assert($("media-preset").options.length === 4, "Four presets available");
  assert(audio.paused, "No autoplay on page load");
  const firstUrl = audio.src;
  $("media-next").click();
  await waitFor(() => audio.readyState >= 1 && audio.src !== firstUrl);
  assert($("media-preset").value === "city" && audio.paused, "Next track preserves paused state");
  $("media-previous").click();
  await waitFor(() => $("media-preset").value === "evening" && audio.readyState >= 1);
  $("media-previous").click();
  await waitFor(() => $("media-preset").value === "coast" && audio.readyState >= 1);
  assert(audio.loop && audio.paused, "Previous wraps to the last looping preset without autoplay");
  $("media-play").click();
  await waitFor(() => !audio.paused);
  const playingUrl = audio.src;
  $("media-next").click();
  await waitFor(() => audio.src !== playingUrl && !audio.paused && audio.readyState >= 1);
  assert($("media-preset").value === "evening", "Next wraps to first track and keeps playing");
  $("media-preset").value = "horizon";
  $("media-preset").dispatchEvent(new Event("change"));
  await waitFor(() => $("media-track").textContent === t("Quiet Horizon") && !audio.paused);
  const beforeLanguage = audio.src;
  setLanguage("de");
  assert(audio.src === beforeLanguage && !audio.paused, "UI language preserves playback");
  assert($("media-track").textContent === t("Quiet Horizon"), "Selected title localizes");
  for (const track of DEMO_TRACKS) {
    assert([...$("media-preset").options].find((option) => option.value === track.id).textContent === t(track.title), "Preset titles localize");
  }
  $("media-pause").click();
  await waitFor(() => audio.paused);
  $("media-demo").click();
  await waitFor(() => $("media-preset").value === "evening" && audio.readyState >= 1);
  assert(audio.paused, "Restore original preserves pause");
  $("media-play").click();
  await waitFor(() => !audio.paused);
  $("media-next").click();
  audio.pause();
  await waitFor(() => audio.readyState >= 1);
  assert(audio.paused, "Pausing a pending preset switch cancels playback");
  assert($("error").hidden, "No playback errors");
  return { passed: true, presets: DEMO_TRACKS.map((track) => track.id), previousNextPassed: true, playingPreserved: true };
})();
