// Run against an isolated cockpit after a real click to permit audio.
(async () => {
  const { command } = await import("/static/cockpit.js");
  const $ = (id) => document.getElementById(id);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const waitFor = async (predicate) => {
    for (let i = 0; i < 200; i++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("Control browser condition timed out.");
  };
  const read = async () => {
    const packet = await command("read_vehicle", { domain: "climate" });
    assert(packet.result.ok, JSON.stringify(packet.result));
    return packet.result.data;
  };
  await waitFor(() => $("control-status").textContent === "Controls connected");
  const original = await read();
  try {
    const baseline = await command("set_climate", { temperature_c: 21 });
    assert(baseline.result.ok, "Climate baseline confirmed");
    document.dispatchEvent(new CustomEvent("cockpit-snapshot", { detail: baseline.state }));
    $("temp-up").click();
    await waitFor(() => $("temperature").textContent === "22" && !$("temp-down").disabled);
    assert((await read()).temperature_c === 22, "Temperature button changes authoritative state");
    $("temp-down").click();
    await waitFor(() => $("temperature").textContent === "21");
    $("climate-temperature").value = 23.5;
    $("climate-temperature").dispatchEvent(new Event("change"));
    await waitFor(() => $("temperature").textContent === "23.5");
    assert((await read()).temperature_c === 23.5, "Temperature range confirms fractional setting");
    $("climate-fan").value = 6;
    $("climate-fan").dispatchEvent(new Event("change"));
    await waitFor(() => !$("climate-fan").disabled);
    assert((await read()).fan === 6 && $("climate-fan-value").textContent === "6", "Airflow range changes authoritative state");
    for (const key of ["power", "ac", "auto", "recirculation", "defrost"]) {
      const input = $(`climate-${key}`);
      const before = (await read())[key];
      input.click();
      await waitFor(() => !input.disabled);
      assert((await read())[key] === !before && input.checked === !before, `${key} switch confirms actual setting`);
    }
    for (const [temperature, disabled, action, expected] of [
      [16.5, "temp-down", "temp-down", 16], [29.5, "temp-up", "temp-up", 30],
    ]) {
      const packet = await command("set_climate", { temperature_c: temperature });
      assert(packet.result.ok, "Boundary command confirmed");
      document.dispatchEvent(new CustomEvent("cockpit-snapshot", { detail: packet.state }));
      $(action).click();
      await waitFor(() => $(disabled).disabled && $("temperature").textContent === String(expected)
        && !$(action === "temp-down" ? "temp-up" : "temp-down").disabled);
      assert($("temperature").textContent === String(expected), "Fractional temperature buttons stop at valid boundary");
      assert((await read()).temperature_c === expected, "Boundary receipt matches the visible setting");
    }
    assert(document.querySelector(".navigation-card #sim-engage") && document.querySelector(".navigation-card #sim-speed")
      && document.querySelector(".navigation-card #sim-gap") && document.querySelector(".navigation-card #sim-warning")
      && document.querySelector(".navigation-card #sim-acknowledge"), "All primary assistance controls belong to the navigation sidebar");
    assert(!/\bdemo\b|simulat|模拟|仿真/i.test(document.body.textContent), "All cockpit text, including collapsed settings, uses operational wording");
    assert(document.documentElement.scrollWidth <= innerWidth, "Controls do not overflow horizontally");
    return `PASS: climate +/- and temperature/fan ranges, all five switches, boundaries, authoritative receipts, sidebar placement and complete UI wording at ${innerWidth}px`;
  } finally {
    const restored = await command("set_climate", original);
    assert(restored.result.ok, `Restore original climate settings: ${JSON.stringify(restored.result)}`);
    document.dispatchEvent(new CustomEvent("cockpit-snapshot", { detail: restored.state }));
  }
})();
