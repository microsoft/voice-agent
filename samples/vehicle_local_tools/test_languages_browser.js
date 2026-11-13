// Run in a loaded cockpit page with agent-browser eval --stdin.
(async () => {
  const { setLanguage, t, currentLanguage } = await import("/static/i18n.mjs");
  const $ = (id) => document.getElementById(id);
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const wait = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate) => {
    for (let i = 0; i < 100; i++) { if (predicate()) return; await wait(); }
    throw new Error("Browser language/media check timed out.");
  };
  await waitFor(() => !$("temp-up").disabled && !$("media-play").disabled);
  const audio = $("local-audio"), originalSource = audio.src;
  const rows = [];
  $("destination-input").value = "My destination stays unchanged";
  for (const language of ["en", "zh", "de", "ja", "ko"]) {
    setLanguage(language);
    await wait();
    assert(document.documentElement.lang === language, "HTML language updates");
    assert($("climate-title").textContent === t("Climate"), "Climate heading translated");
    assert($("media-title").textContent === t("Music"), "Music heading translated");
    assert($("nav-status").textContent === t("NOT SET"), "Dynamic navigation badge translated");
    assert($("phone-summary").textContent === t("READY"), "Dynamic phone badge translated");
    assert($("media-availability").textContent === t("AUDIO READY"), "Dynamic media status translated");
    assert($("media-next").getAttribute("aria-label") === t("Next track"), "Accessible media labels translated");
    assert($("cluster-theme").value === "dark", "Theme protocol values remain English");
    assert($("cluster-units").value === "metric", "Unit protocol values remain English");
    assert($("destination-input").value === "My destination stays unchanged", "Language switching preserves in-progress input");
    assert(audio.src === originalSource && audio.paused, "Language switching never resets or autoplays audio");
    rows.push({ language, title: $("climate-title").textContent, next: $("media-next").getAttribute("aria-label") });
  }
  const temperature = Number($("climate-temperature").value);
  $("temp-up").click();
  await waitFor(() => Number($("climate-temperature").value) === temperature + 1);
  $("temp-down").click();
  await waitFor(() => Number($("climate-temperature").value) === temperature);
  setLanguage("auto");
  assert($("ui-language").value === "auto", "Browser-language Auto remains selected");
  assert(["en", "zh", "de", "ja", "ko"].includes(currentLanguage()), "Auto resolves to a supported language");
  setLanguage("zh");
  $("destination-input").value = "";
  assert($("error").hidden, "No UI or control error");
  return { passed: true, languages: rows, localControlPassed: true, autoPassed: true };
})();
