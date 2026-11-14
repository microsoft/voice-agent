// Run against an isolated, Web IQ-configured cockpit. Run again after reload
// with window.webiqReloadAcceptance=true to verify saved client preferences.
(async () => {
  const { command, setWebIQEnabled, waitForWebIQPreference, webiqSnapshot } = await import("/static/cockpit.js");
  const $ = (id) => document.getElementById(id);
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const waitFor = async (predicate) => {
    for (let i = 0; i < 200; i++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("Web IQ browser condition timed out.");
  };
  await waitFor(() => $("control-status").textContent === "Controls connected");
  await waitForWebIQPreference();
  assert(webiqSnapshot().available && !$("webiq-toggle").disabled, "Configured service is available without exposing its key");
  if (window.webiqReloadAcceptance) {
    assert(!webiqSnapshot().enabled && !$("webiq-toggle").checked, "Reload retains the client's off preference");
    await setWebIQEnabled(true);
    assert(webiqSnapshot().enabled && $("webiq-toggle").checked, "Client can opt back in after reload");
    return "PASS: persisted opt-out survives reload and can be enabled again";
  }
  assert($("webiq-toggle").checked && webiqSnapshot().enabled, "Default is enabled");
  const info = await (await fetch("/api/state")).json();
  assert(Object.keys(info.grounding).sort().join(",") === "enabled,health", "Public configuration contains no credentials");
  const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/control`);
  const messages = [];
  socket.onmessage = ({ data }) => messages.push(JSON.parse(data));
  socket.onerror = () => { messages.push({ type: "test_error" }); };
  try {
    await waitFor(() => messages.some((packet) => packet.type === "control_ready" || packet.type === "test_error"));
    const ready = messages.find((packet) => packet.type === "control_ready");
    assert(ready?.grounding.enabled, "Second client starts independently enabled");
    $("webiq-toggle").click();
    await waitFor(() => !$("webiq-toggle").disabled && !webiqSnapshot().enabled);
    assert($("webiq-status").textContent.includes("Off") && localStorage.getItem("aura.webiq.enabled") === "false", "UI confirms server opt-out and saves the client preference");
    const climate = await command("read_vehicle", { domain: "climate", fields: ["temperature_c"] });
    assert(climate.result.ok && typeof climate.result.data.temperature_c === "number", "Vehicle controls remain available while Web IQ is off");
    socket.send(JSON.stringify({ type: "webiq_preference", id: "second-client", epoch: ready.epoch, enabled: true }));
    await waitFor(() => messages.some((packet) => packet.type === "webiq_state"));
    assert(messages.find((packet) => packet.type === "webiq_state").grounding.enabled, "Disabling one client does not disable another");
    assert(!webiqSnapshot().enabled, "Other client acknowledgement does not change this client's UI");
    await setWebIQEnabled(true);
    assert($("webiq-toggle").checked && webiqSnapshot().enabled, "Enabled state is confirmed by server");
    await setWebIQEnabled(false);
    assert(!webiqSnapshot().enabled, "Leave opt-out for reload acceptance");
    assert(document.documentElement.scrollWidth <= innerWidth, "Web IQ control fits without horizontal overflow");
    return `PASS: default-on toggle, acknowledgement, independent owners, credential-free configuration, vehicle controls and saved opt-out at ${innerWidth}px`;
  } finally {
    socket.close();
  }
})();
