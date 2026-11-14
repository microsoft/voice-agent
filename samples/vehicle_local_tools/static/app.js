import { AudioPlayer } from "./playback.js";
import { t, setText, currentLanguage } from "./i18n.mjs";
import { driveClock, initializeDriveCycle } from "./drive-cycle.mjs";
import { applySnapshot, applyWebIQState, browserOwner, command, connectControls, selectedMotion, setVoiceLink, showSources, simulatorSnapshot, waitForWebIQPreference } from "./cockpit.js";

const $ = (id) => document.getElementById(id);
let state = null;
let socket = null;
let context = null;
let stream = null;
let capture = null;
let source = null;
let silence = null;
let player = null;
let audioGeneration = 0;
const pendingControls = new Set();
const navigationTools = new Set(["set_destination", "clear_destination", "edit_itinerary", "set_navigation_preferences"]);
const navigationActions = new Map();
let navigationError = "";
let editingStop = null;
let editingStops = "";
let connecting = false;
let ready = false;
let cloudMode = false;
let generation = 0;
const doorNames = ["front_left", "front_right", "rear_left", "rear_right"];
const manualControls = ["temp-down", "temp-up", "volume", "destination-input",
  "doors-open", "doors-close", "lid-hood", "lid-trunk",
  ...doorNames.flatMap((name) => [`door-${name}`, `window-${name}`])];
let processTurn = null;
const processStages = ["listening", "understanding", "searching", "discovered", "executing", "responding"];

function step(stage, status) {
  document.querySelector(`[data-step="${stage}"]`).dataset.state = status;
}
function resetProcess(turn) {
  processTurn = turn;
  for (const stage of processStages) step(stage, "idle");
  setText("process-query", "Direct tools / no discovery required");
  setText("process-result", "No local action yet");
  $("process-matches").replaceChildren();
  const empty = document.createElement("span");
  empty.className = "process-empty";
  empty.textContent = t("Available direct tools are selected by capability");
  $("process-matches").append(empty);
}
function formatArguments(raw) {
  try { return JSON.stringify(JSON.parse(raw), null, 2); }
  catch { return String(raw); }
}
export function processEvent(event) {
  const activity = {
    listening: "Listening to you.", understanding: "Choosing the next action.",
    executing: "Updating your cockpit.", result: event.result?.ok ? "Cockpit update confirmed." : "The requested update could not be completed.",
    responding: "Preparing your reply.", complete: "Ready for your next request.", interrupted: "Listening to you.",
  };
  setText("request-activity", activity[event.stage] || event.detail);
  const turn = event.next_turn ?? event.turn;
  if (event.stage === "executing") navigationAction(`voice-${turn}-${event.name}`, event.name, true);
  if (event.stage === "result") navigationAction(`voice-${turn}-${event.name}`, event.name, false, event.result?.ok === false ? event.result.error || "Navigation update failed." : "");
  if (event.stage === "complete" || event.stage === "interrupted") {
    finishVoiceNavigation("Navigation result was not confirmed.", event.turn ?? turn);
  }
  if (turn !== processTurn) resetProcess(turn);
  setText("process-pill", "TURN {turn} / {stage}", { turn, stage: t(event.stage.toUpperCase()) });
  $("process-detail").textContent = event.detail;
  if (event.stage === "listening") step("listening", "active");
  if (event.stage === "understanding") {
    if (document.querySelector('[data-step="listening"]').dataset.state === "active") step("listening", "done");
    step("understanding", "active");
  }
  if (event.stage === "searching") {
    step("understanding", "done");
    step("responding", "idle");
    step("searching", "active");
    step("discovered", "idle");
    $("process-query").textContent = formatArguments(event.arguments);
  }
  if (event.stage === "discovered") {
    step("searching", event.result.ok ? "done" : "error");
    step("discovered", event.result.ok && event.result.matches.length ? "done" : "error");
    $("process-matches").replaceChildren();
    for (const tool of event.result.matches || []) {
      const chip = document.createElement("details");
      chip.className = "match-chip";
      const summary = document.createElement("summary");
      summary.textContent = tool.name;
      const definition = document.createElement("pre");
      definition.textContent = `${tool.description}\n\n${JSON.stringify(tool.parameters, null, 2)}`;
      chip.append(summary, definition);
      $("process-matches").append(chip);
    }
    if (!event.result.matches?.length) {
      const empty = document.createElement("span");
      empty.className = "process-empty";
      empty.textContent = event.result.error || "No matching local capabilities";
      $("process-matches").append(empty);
    }
  }
  if (event.stage === "executing") {
    step("understanding", "done");
    step("responding", "idle");
    if (document.querySelector('[data-step="searching"]').dataset.state === "idle") {
      step("searching", "skipped"); step("discovered", "skipped");
      setText("process-query", "Direct tool call / no search");
      setText("process-matches", "No discovery round trip");
    }
    step("executing", "active");
    $("process-result").textContent = `${event.name}\n${formatArguments(event.arguments)}\n\nAwaiting local policy and execution result…`;
  }
  if (event.stage === "result") {
    step("executing", event.result.ok ? "done" : "error");
    $("process-result").textContent = `${event.name}\n${JSON.stringify(event.result, null, 2)}`;
  }
  if (event.stage === "responding") step("responding", "active");
  if (event.stage === "complete") {
    step("understanding", "done"); step("responding", "done");
    for (const stage of processStages) {
      if (document.querySelector(`[data-step="${stage}"]`).dataset.state === "idle") step(stage, "skipped");
    }
    setText("process-pill", "TURN {turn} / {stage}", { turn, stage: t("RESPONSE READY") });
  }
  if (event.stage === "interrupted") {
    for (const stage of processStages) {
      if (document.querySelector(`[data-step="${stage}"]`).dataset.state === "active") step(stage, "skipped");
    }
    setText("process-pill", "TURN {turn} / {stage}", { turn, stage: t("INTERRUPTED") });
  }
  log(`PROCESS / ${event.stage.toUpperCase()}`, event.detail, event.result?.ok === false);
}

function error(message) {
  finishVoiceNavigation(message);
  $("error").textContent = t(message);
  $("error").hidden = false;
  for (const stage of processStages) {
    if (document.querySelector(`[data-step="${stage}"]`).dataset.state === "active") step(stage, "error");
  }
  if (processTurn !== null) {
    setText("process-pill", "PROCESS INTERRUPTED");
    $("process-detail").textContent = message;
  }
}
function clearError() { $("error").hidden = true; }
function log(label, text, rejected = false) {
  const container = $("activity");
  container.querySelector(".empty-log")?.remove();
  const row = document.createElement("div");
  row.className = `log-entry${rejected ? " rejected" : ""}`;
  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString(currentLanguage(), { hour: "2-digit", minute: "2-digit" });
  const body = document.createElement("div");
  const title = document.createElement("span");
  title.className = "log-label";
  title.textContent = t(label);
  const content = document.createElement("p");
  content.textContent = text;
  body.append(title, content);
  row.append(time, body);
  container.append(row);
  while (container.children.length > 100) container.firstElementChild.remove();
  container.scrollTop = container.scrollHeight;
}
function controls() {
  for (const id of manualControls) {
    const domain = id.startsWith("temp") ? "climate" : id === "volume" ? "media" : id === "destination-input" ? "navigation" : "body";
    $(id).disabled = pendingControls.has(domain) || !state;
  }
  $("nav-form").querySelector("button").disabled = pendingControls.has("navigation") || !state;
  if (state && !pendingControls.has("climate")) {
    $("temp-down").disabled = state.temperature_c <= 16;
    $("temp-up").disabled = state.temperature_c >= 30;
  }
  renderNavigation();
}
function navigationAction(id, name, busy, failure = "") {
  if (!navigationTools.has(name)) return;
  if (busy) {
    navigationActions.set(id, name);
    navigationError = "";
  } else {
    navigationActions.delete(id);
    if (failure) navigationError = failure;
  }
  renderNavigation();
}
function finishVoiceNavigation(failure, turn) {
  for (const [id, name] of navigationActions) {
    if (id.startsWith(turn === undefined ? "voice-" : `voice-${turn}-`)) navigationAction(id, name, false, failure);
  }
}
function renderNavigation() {
  if (!state) return;
  const panel = document.querySelector(".navigation-card"), saved = Boolean(state.destination);
  const busy = navigationActions.size > 0, action = [...navigationActions.values()].at(-1);
  const stops = state.domains.navigation.stops;
  const signature = JSON.stringify(stops);
  if (editingStop !== null && signature !== editingStops) {
    resetNavigationEditor();
    error("The itinerary changed. Select a stop again before editing.");
  }
  panel.dataset.destinationSet = String(saved);
  panel.dataset.navigation = busy ? "pending" : navigationError ? "error" : saved ? "saved" : "empty";
  panel.setAttribute("aria-busy", String(busy));
  const status = busy ? action === "clear_destination" ? "CLEARING" : ["set_destination", "edit_itinerary"].includes(action) ? "SAVING" : "UPDATING"
    : navigationError ? "FAILED" : saved ? "SAVED" : "NOT SET";
  setText("nav-status", status);
  $("destination").textContent = state.destination || t("No destination selected");
  setText("nav-confirmation", busy ? "Waiting for cockpit confirmation."
    : navigationError ? "Update not confirmed. Check saved destination."
      : saved ? "{count} / 8 stops saved · no route or ETA" : "Up to 8 stops · no route or ETA", { count: stops.length });
  $("nav-confirmation").title = navigationError;
  const submit = $("nav-form").querySelector("button");
  submit.textContent = t(busy ? "Wait" : editingStop !== null ? "Save" : "Add");
  submit.setAttribute("aria-label", t(editingStop !== null ? "Save destination" : "Add destination"));
  submit.disabled = busy || pendingControls.has("navigation") || editingStop === null && stops.length >= 8;
  $("destination-input").disabled = busy || pendingControls.has("navigation");
  $("destination-input").placeholder = editingStop !== null ? t("Edit stop {number}", { number: editingStop + 1 }) : t("Add a destination…");
  $("nav-cancel-edit").hidden = editingStop === null;
  $("nav-cancel-edit").disabled = busy;
  const list = $("nav-stops");
  const listSignature = JSON.stringify([stops, busy, currentLanguage()]);
  if (list.dataset.signature !== listSignature) {
    list.dataset.signature = listSignature;
    list.replaceChildren(...stops.map((stop, index) => {
      const row = document.createElement("li");
      const number = document.createElement("span");
      number.className = "stop-number"; number.textContent = String(index + 1).padStart(2, "0");
      const name = document.createElement("span");
      name.className = "stop-name"; name.textContent = stop;
      const edit = document.createElement("button");
      edit.type = "button"; edit.textContent = t("Edit"); edit.disabled = busy;
      edit.setAttribute("aria-label", t("Edit stop {number}", { number: index + 1 }));
      edit.onclick = () => {
        editingStop = index; editingStops = signature;
        $("destination-input").value = stop;
        renderNavigation(); $("destination-input").focus();
      };
      const remove = document.createElement("button");
      remove.type = "button"; remove.textContent = "×"; remove.disabled = busy;
      remove.setAttribute("aria-label", t("Remove stop {number}", { number: index + 1 }));
      remove.onclick = () => { void tool("edit_itinerary", { action: "remove", index }); };
      row.append(number, name, edit, remove);
      return row;
    }));
  }
  $("nav-clear").disabled = busy || !saved;
  for (const key of ["avoid_tolls", "avoid_highways"]) $(`nav-${key}`).disabled = busy;
  const selected = ["avoid_tolls", "avoid_highways"].filter((key) => state.domains.navigation[key]).length;
  setText("nav-preferences-label", selected ? "Preferences · {count} selected" : "Destination preferences", { count: selected });
}
function resetNavigationEditor() {
  editingStop = null;
  editingStops = "";
  $("destination-input").value = "";
}
$("nav-cancel-edit").onclick = () => { resetNavigationEditor(); renderNavigation(); $("destination-input").focus(); };
function render(next) {
  if (state && state.destination !== next.destination) navigationError = "";
  state = next;
  applySnapshot(next);
  $("temperature").textContent = Number(next.temperature_c).toLocaleString(currentLanguage(), { maximumFractionDigits: 1 });
  if (document.activeElement !== $("climate-temperature")) $("climate-temperature").value = next.temperature_c;
  $("volume").value = next.volume_percent;
  $("volume-value").textContent = `${next.volume_percent}%`;
  for (const name of doorNames) {
    const button = $(`door-${name}`);
    button.setAttribute("aria-pressed", String(next.doors[name]));
    button.querySelector("span").textContent = t(next.doors[name] ? "Open" : "Closed");
    const windowButton = $(`window-${name}`);
    windowButton.setAttribute("aria-pressed", String(next.windows[name]));
    const door = name.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
    windowButton.setAttribute("aria-label", t(next.windows[name] ? "Raise {door} window" : "Lower {door} window",
      { door: currentLanguage() === "en" ? door.toLowerCase() : t(door) }));
    windowButton.firstChild.textContent = `${t(next.windows[name] ? "Raise window" : "Lower window")} `;
    windowButton.querySelector("span").textContent = t(next.windows[name] ? "Glass lowered" : "Glass raised");
  }
  for (const name of ["hood", "trunk"]) {
    $(`lid-${name}`).setAttribute("aria-pressed", String(next.lids[name]));
    $(`lid-${name}`).querySelector("span").textContent = t(next.lids[name] ? "Open" : "Closed");
  }
  const open = Object.values(next.doors).filter(Boolean).length;
  setText("doors-summary", open ? "{count} of 4 doors open" : "All doors closed", { count: open });
  document.dispatchEvent(new CustomEvent("vehicle-state", { detail: next }));
  controls();
}
function toolSummary(result) {
  if (!result.ok) return result.error;
  if (result.matches) {
    return result.matches.length
      ? `Discovered: ${result.matches.map((tool) => tool.name).join(", ")}`
      : "No matching local capabilities found.";
  }
  if (!result.state) return JSON.stringify(result.changed || result.data || { scope: result.scope, ok: result.ok });
  const s = result.state;
  return `Cabin ${s.temperature_c} °C · volume ${s.volume_percent}% · destination ${s.destination || "not set"} · doors: ${doorNames.map((name) => `${name.replaceAll("_", " ")} ${s.doors[name] ? "open" : "closed"}`).join(", ")} · windows lowered: ${doorNames.filter((name) => s.windows[name]).join(", ") || "none"} · hood ${s.lids.hood ? "open" : "closed"} · trunk ${s.lids.trunk ? "open" : "closed"}`;
}
async function tool(name, args) {
  const domain = name.includes("climate") ? "climate" : name.includes("media") ? "media" : navigationTools.has(name) ? "navigation" : "body";
  if (pendingControls.has(domain)) return;
  pendingControls.add(domain);
  navigationAction("manual", name, true);
  controls();
  clearError();
  let focusDestination = false;
  try {
    const packet = await command(name, args);
    const result = packet.result;
    log(result.ok ? `LOCAL / ${name}` : "LOCAL POLICY / REJECTED", toolSummary(result), !result.ok);
    if (result.ok && ["set_destination", "clear_destination", "edit_itinerary"].includes(name)) {
      resetNavigationEditor();
      focusDestination = true;
    }
    render(packet.state);
    if (!result.ok) throw new Error(result.error || "Local control failed.");
  } catch (e) {
    if (navigationTools.has(name)) navigationError = e.message;
    error(e.message);
    if (state) render(state);
  } finally {
    pendingControls.delete(domain);
    navigationAction("manual", name, false);
    controls();
    if (focusDestination) $("destination-input").focus();
  }
}
$("temp-down").onclick = () => tool("set_climate", { temperature_c: Math.max(16, state.temperature_c - 1) });
$("doors-open").onclick = () => tool("set_vehicle_doors", { door: "all", is_open: true });
$("doors-close").onclick = () => tool("set_vehicle_doors", { door: "all", is_open: false });
for (const name of doorNames) {
  $(`door-${name}`).onclick = () => tool("set_vehicle_doors", { door: name, is_open: !state.doors[name] });
  $(`window-${name}`).onclick = () => tool("set_vehicle_windows", { window: name, is_open: !state.windows[name] });
}
for (const name of ["hood", "trunk"]) {
  $(`lid-${name}`).onclick = () => tool("set_vehicle_lid", { lid: name, is_open: !state.lids[name] });
}
$("temp-up").onclick = () => tool("set_climate", { temperature_c: Math.min(30, state.temperature_c + 1) });
$("volume").oninput = () => { $("volume-value").textContent = `${$("volume").value}%`; };
$("volume").onchange = () => tool("set_media_volume", { volume_percent: Number($("volume").value) });
$("nav-form").onsubmit = (event) => {
  event.preventDefault();
  const destination = $("destination-input").value.trim();
  if (!destination) { error("Enter a destination first."); return; }
  void tool("edit_itinerary", editingStop === null
    ? { action: "append", destination }
    : { action: "update", index: editingStop, destination });
};
$("clear-log").onclick = () => { $("activity").replaceChildren(); };

function stop() {
  finishVoiceNavigation("Voice stopped before navigation was confirmed.");
  generation++;
  ready = false;
  setVoiceLink(null);
  connecting = false;
  if (capture) { capture.port.onmessage = null; capture.disconnect(); capture = null; }
  source?.disconnect(); source = null;
  silence?.disconnect(); silence = null;
  stream?.getTracks().forEach((track) => track.stop()); stream = null;
  player?.close(); player = null;
  if (context) void context.close();
  context = null;
  const old = socket;
  socket = null;
  old?.close();
  setText("connect-label", "Connect voice agent");
  setText("connection-pill", "DISCONNECTED");
  setText("voice-title", "Ready when you are.");
  setText("voice-status", "Microphone off. Local controls remain available.");
  setText("request-activity", "Your cockpit, controlled by voice.");
  document.querySelector(".assistant-card").classList.remove("connected", "connecting");
  $("agent-visual").setAttribute("aria-label", t("AI agent disconnected"));
  if (processTurn !== null && processStages.some((stage) => document.querySelector(`[data-step="${stage}"]`).dataset.state === "active")) {
    for (const stage of processStages) {
      if (document.querySelector(`[data-step="${stage}"]`).dataset.state === "active") step(stage, "error");
    }
    setText("process-pill", "PROCESS INTERRUPTED");
    $("process-detail").textContent = "Disconnected. Already executed local actions are not undone.";
  }
}
function play(buffer, metadata) {
  if (!context || !ready) return;
  if (metadata.generation < audioGeneration) return;
  if (metadata.generation !== audioGeneration) throw new Error("Unexpected audio playback generation.");
  player.enqueue(buffer, metadata);
}
async function connect() {
  if (connecting || socket) { stop(); return; }
  clearError();
  connecting = true;
  document.querySelector(".assistant-card").classList.add("connecting");
  $("agent-visual").setAttribute("aria-label", t("AI agent connecting"));
  const attempt = ++generation;
  setText("connect-label", "Cancel connection");
  setText("connection-pill", "CONNECTING");
  setText("voice-status", "Requesting microphone access and opening cloud session…");
  let acquired = null;
  try {
    const audioContext = new AudioContext({ sampleRate: 24000 });
    context = audioContext;
    if (audioContext.sampleRate !== 24000) throw new Error("This browser must support a 24 kHz AudioContext. Try current Edge or Chrome.");
    await audioContext.resume();
    await audioContext.audioWorklet.addModule("/static/pcm-worklet.js");
    await waitForWebIQPreference();
    if (attempt !== generation) return;
    acquired = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (attempt !== generation) { acquired.getTracks().forEach((track) => track.stop()); return; }
    stream = acquired;
    const owner = browserOwner();
    if (!owner) throw new Error("Connect cockpit controls before voice.");
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?owner=${encodeURIComponent(owner)}`);
    socket = ws;
    ws.binaryType = "arraybuffer";
    ws.onmessage = (event) => {
      if (socket !== ws) return;
      try {
        if (event.data instanceof ArrayBuffer) throw new Error("Audio must include its response and message identity.");
        const message = JSON.parse(event.data);
        if (message.type === "ready") {
          if (message.owner !== owner || browserOwner() !== owner || !message.capabilities?.includes("control_autopilot")) {
            throw new Error("Voice is not linked to this cockpit. Reconnect controls and voice.");
          }
          connecting = false; ready = true;
          setVoiceLink(owner);
          audioGeneration = 0;
          player = new AudioPlayer(context, (failure) => { error(failure.message); stop(); });
          setText("connect-label", "Disconnect voice agent");
          setText("connection-pill", "CONNECTED");
          setText("voice-title", "Let's take it from here.");
          setText("voice-status", "Microphone on. Speak naturally. Talk over a reply to interrupt it.");
          document.querySelector(".assistant-card").classList.add("connected");
          document.querySelector(".assistant-card").classList.remove("connecting");
          $("agent-visual").setAttribute("aria-label", t("AI agent connected and active"));
          source = context.createMediaStreamSource(stream);
          capture = new AudioWorkletNode(context, "pcm-capture");
          silence = context.createGain(); silence.gain.value = 0;
          capture.port.onmessage = ({ data }) => {
            if (socket !== ws || ws.readyState !== WebSocket.OPEN || !ready) return;
            if (ws.bufferedAmount > 24000 * 2 * 3) { error("Microphone upload is falling behind."); stop(); return; }
            ws.send(data);
          };
          source.connect(capture); capture.connect(silence); silence.connect(context.destination);
          log("CLOUD / CONNECTED", "Audio goes to Foundry. Vehicle tools update local cockpit state.");
        } else if (message.type === "audio") {
          if (!ready || message.generation < audioGeneration) return;
          const decoded = atob(message.pcm);
          const pcm = new Uint8Array(decoded.length);
          for (let i = 0; i < decoded.length; i++) pcm[i] = decoded.charCodeAt(i);
          play(pcm.buffer, message);
        } else if (message.type === "interrupt") {
          if (!player || !ready) throw new Error("Playback interruption arrived before audio was ready.");
          audioGeneration = message.generation;
          const items = player.interrupt(message.items);
          ws.send(JSON.stringify({type: "playback_interrupted", sequence: message.sequence, items}));
          log("PLAYBACK / INTERRUPTED", "Queued speech cleared. The cloud conversation will be truncated to the audio played.");
        } else if (message.type === "progress") {
          setText("voice-status", message.message);
        } else if (message.type === "process") {
          processEvent(message);
        } else if (message.type === "agent") {
          log("CLOUD / AGENT", `${message.name} · reused across reconnects`);
        } else if (message.type === "transcript") {
          log(message.role === "user" ? "YOU" : "VOICE AGENT", message.text);
        } else if (message.type === "tool") {
          if (message.grounding) applyWebIQState(message.grounding);
          render(message.state);
          showSources(message.result);
          log(message.result.ok ? `LOCAL / ${message.name}` : "LOCAL POLICY / REJECTED", toolSummary(message.result), !message.result.ok);
        } else if (message.type === "error") {
          error(message.message); stop();
        }
      } catch (e) { error(e.message); stop(); }
    };
    ws.onerror = () => {
      if (socket === ws) { error("Voice connection failed. Check the local server log."); stop(); }
    };
    ws.onclose = () => {
      if (socket === ws) { error("Voice session disconnected. Microphone stopped."); stop(); }
    };
  } catch (e) {
    acquired?.getTracks().forEach((track) => track.stop());
    if (attempt === generation) { error(e.message); stop(); }
  }
}
$("connect").onclick = () => { void connect(); };
document.addEventListener("cockpit-snapshot", (event) => render(event.detail));
document.addEventListener("cockpit-error", (event) => error(event.detail));
document.addEventListener("cockpit-link", ({ detail }) => {
  $("connect").disabled = !cloudMode || !detail.owner;
  if (!detail.owner && (connecting || socket)) {
    error("Cockpit controls disconnected. Voice stopped. Reconnect controls, then reconnect voice.");
    stop();
  }
});
document.addEventListener("cockpit-result", ({ detail }) => {
  log(detail.result.ok ? `LOCAL / ${detail.name}` : "LOCAL POLICY / REJECTED", toolSummary(detail.result), !detail.result.ok);
});
document.addEventListener("cockpit-action", ({ detail }) => navigationAction(detail.id, detail.name, detail.busy, detail.error));
window.addEventListener("pagehide", stop);
function clock() { $("clock").textContent = new Date().toLocaleTimeString(currentLanguage(), { hour: "2-digit", minute: "2-digit" }); }
document.addEventListener("ui-language-change", () => {
  if (state) render(state);
  clock();
  $("agent-visual").setAttribute("aria-label", t(ready ? "AI agent connected and active" : connecting ? "AI agent connecting" : "AI agent disconnected"));
});
clock(); setInterval(clock, 10000);
try {
  const [response, trace] = await Promise.all([fetch("/api/state"), fetch("/static/ftp75.txt")]);
  if (!response.ok) throw new Error("Could not load local cockpit state.");
  if (!trace.ok) throw new Error("Could not load the EPA FTP-75 speed trace.");
  initializeDriveCycle(await trace.text(), performance.now());
  const info = await response.json();
  cloudMode = info.mode === "cloud";
  render(info.state);
  connectControls(info);
  const formatTime = (seconds) => `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
  function renderDrive(time) {
    const trace = driveClock.sample(time);
    const simulated = simulatorSnapshot();
    const reference = selectedMotion() === "reference";
    const speed = simulated.actual_speed_kmh;
    const imperial = state?.domains?.cluster.units === "imperial";
    $("cluster-speed-value").textContent = (speed * (imperial ? .621371 : 1)).toFixed(1);
    $("cluster-speed-unit").textContent = imperial ? "mph" : "km/h";
    setText("cluster-source", reference ? "EPA FTP-75 / automatic loop" : "Autopilot / speed control");
    setText("drive-status", reference ? "EPA AUTO DRIVE" : "AUTOPILOT ACTIVE");
    $("drive-progress").textContent = `${formatTime(trace.cycleSeconds)} / ${formatTime(trace.durationSeconds)} / ${t(reference ? "EPA loop playing" : "Autopilot speed override")}`;
    requestAnimationFrame(renderDrive);
  }
  requestAnimationFrame(renderDrive);
  if (info.public_demo) {
    setText("voice-caption", "Speak naturally. Your cockpit follows.");
    $("public-policy").hidden = false;
    setText("public-policy-details", "Shared vehicle controls, one voice session at a time, {minutes} minutes per session and {starts} starts per rolling day across all visitors. Do not enter private information. Audio is sent to Azure.",
      { minutes: info.voice_session_seconds / 60, starts: info.voice_starts_per_day });
    log("SHARED COCKPIT", "Vehicle state is shared by all visitors. No real vehicle is connected. Hosting and voice usage are paid by the site owner.");
  }
  if (info.mode === "offline") {
    setText("connect-label", "Offline cockpit");
    setText("voice-title", "Explore your cockpit.");
    setText("voice-caption", "Explore local controls. Voice is offline.");
    setText("voice-status", "Voice is unavailable in offline mode. Start the server with cloud voice enabled.");
    log("COCKPIT / READY", "Local controls are ready. Battery, range, and map are reference values, not live telemetry.");
  } else {
    $("connect").disabled = !browserOwner();
    setText("connect-label", "Connect voice agent");
    setText("connection-pill", "AVAILABLE");
    setText("voice-status", "Microphone stays off until you connect.");
  }
} catch (e) { error(e.message); setText("connect-label", "Cockpit unavailable"); controls(); }
