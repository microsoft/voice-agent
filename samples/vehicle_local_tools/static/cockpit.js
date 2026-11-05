import { autopilot, motionSource } from "./autopilot-sim.mjs";
import { createDemoTrack, DEMO_TRACKS, LocalMediaPlayer } from "./media-player.mjs";
import { t, setText, clearTextBinding } from "./i18n.mjs";
import { driveClock } from "./drive-cycle.mjs";
import { LocalPhone } from "./phone-demo.mjs";

const $ = (id) => document.getElementById(id);
const localMedia = new LocalMediaPlayer($("local-audio"));
const localPhone = new LocalPhone();
let phoneTick = performance.now();
let channel = null;
let epoch = null;
let voiceOwner = null;
let sharedState = null;
let contracts = [];
let lastControlContact = 0;
const webiqStorageKey = "aura.webiq.enabled";
let webiqRequested = true;
let webiqPreferenceLoaded = false;
let webiqSync = null;
let webiqState = { available: false, requested: true, enabled: false, health: "unconfigured" };
const pending = new Map();
const recent = new Map();
export function browserOwner() { return epoch; }
export function webiqSnapshot() { return { ...webiqState }; }
export async function waitForWebIQPreference() { if (webiqSync) await webiqSync; }
function renderWebIQ() {
  const health = {
    not_tested: "On · public information only", ready: "On · sources available",
    auth_failed: "Unavailable · authentication failed", service_error: "Unavailable · service error",
    connection_failed: "Unavailable · connection failed", protocol_error: "Unavailable · response error",
    lookup_failed: "Lookup failed · ask again", timeout: "Lookup timed out · ask again",
  };
  $("webiq-toggle").checked = webiqRequested;
  $("webiq-toggle").disabled = !epoch || !webiqState.available || Boolean(webiqSync);
  const status = !epoch ? "Controls disconnected" : webiqSync ? "Updating preference…"
    : !webiqState.requested ? "Off · model knowledge" : !webiqState.available ? "Unavailable · not configured"
      : health[webiqState.health];
  setText("webiq-status", status);
  $("grounding-health").textContent = `Web IQ / ${t(status)}`;
}
export function applyWebIQState(state) {
  webiqState = state;
  if (!webiqSync) webiqRequested = state.requested;
  renderWebIQ();
}
export function setWebIQEnabled(enabled) {
  if (typeof enabled !== "boolean" || !epoch || webiqSync) return Promise.reject(new Error("Wait for the current Web IQ preference or reconnect controls."));
  webiqRequested = enabled;
  const id = crypto.randomUUID();
  const request = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id); reject(new Error("Web IQ preference was not confirmed. Reconnect cockpit controls."));
    }, 5000);
    pending.set(id, { resolve, reject, timeout });
    try { send({ type: "webiq_preference", id, epoch, enabled }); }
    catch (error) { clearTimeout(timeout); pending.delete(id); reject(error); }
  });
  webiqSync = request.finally(() => { webiqSync = null; webiqRequested = webiqState.requested; renderWebIQ(); });
  renderWebIQ();
  return webiqSync;
}
$("webiq-toggle").onchange = () => {
  void setWebIQEnabled($("webiq-toggle").checked).catch((error) => { report(error.message); channel?.close(); });
};
export function simulatorSnapshot() { return autopilot.snapshot(); }
export function selectedMotion() { return motionSource.value; }
export function phoneSnapshot() { return localPhone.snapshot(); }
export function setVoiceLink(owner) {
  voiceOwner = owner;
  renderLink();
}
function renderLink() {
  const linked = Boolean(epoch && epoch === voiceOwner);
  $("voice-link").dataset.linked = String(linked);
  setText("voice-link", linked ? "Voice linked to this cockpit" : epoch ? "Cockpit ready / microphone off" : "Cockpit disconnected");
  setText("sim-link", linked ? "VOICE LINKED" : "VOICE OFF");
  document.querySelector(".process-card").dataset.connection = linked ? "voice" : epoch ? "ready" : "offline";
  setText("header-connection", linked ? "VOICE LINKED" : epoch ? "CONTROLS READY" : "CONTROLS OFFLINE");
}
function report(message) { document.dispatchEvent(new CustomEvent("cockpit-error", { detail: message })); }
function send(packet) {
  if (!channel || channel.readyState !== WebSocket.OPEN) throw new Error("Control channel is not ready. Reconnect cockpit controls.");
  channel.send(JSON.stringify(packet));
}
function publish(domain) {
  if (!epoch || channel?.readyState !== WebSocket.OPEN) return;
  const state = domain === "autopilot" ? autopilot.snapshot() : domain === "phone" ? localPhone.snapshot() : localMedia.snapshot();
  send({ type: "browser_state", epoch, domain, state });
}
export function command(name, args) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timeout = setTimeout(() => {
      pending.delete(id); reject(new Error("Command timed out. Completion is unknown; check local state."));
    }, 5000);
    pending.set(id, { resolve, reject, timeout });
    try { send({ type: "command", id, name, arguments: args, revision: sharedState?.rev }); }
    catch (e) { clearTimeout(timeout); pending.delete(id); reject(e); }
  });
}
export function applySnapshot(state) {
  sharedState = state;
  const d = state.domains;
  if (!d) return;
  localMedia.setVolume(state.volume_percent);
  autopilot.setConditions({ bodyReady: ![state.doors, state.lids].some((parts) => Object.values(parts).some(Boolean)) });
  document.documentElement.dataset.cockpitTheme = d.cluster.theme;
  document.documentElement.dataset.clusterLayout = d.cluster.layout;
  $("cluster-readout").style.opacity = d.cluster.brightness / 100;
  $("cluster-units").value = d.cluster.units;
  $("cluster-theme").value = d.cluster.theme;
  $("cluster-layout").value = d.cluster.layout;
  $("cluster-brightness").value = d.cluster.brightness;
  $("climate-fan").value = d.climate.fan;
  $("climate-fan-value").textContent = d.climate.fan;
  for (const key of ["power", "ac", "auto", "recirculation", "defrost"]) $(`climate-${key}`).checked = d.climate[key];
  for (const key of ["avoid_tolls", "avoid_highways"]) $(`nav-${key}`).checked = d.navigation[key];
  $("assist-detail").value = d.assist.detail;
  $("assist-tips").checked = d.assist.tips;
  $("assist-help").hidden = !d.assist.tips;
  $("assist-explanation").hidden = d.assist.detail !== "detailed";
  $("phone-notifications").checked = d.phone.notifications;
  $("phone-detail").value = d.phone.detail;
  $("phone-preference-status").textContent = t(d.phone.notifications ? "Panel notifications enabled" : "Panel notifications disabled")
    + (d.phone.detail === "detailed" ? ` / ${t("Select a contact from the address book to call.")}` : "");
  publish("autopilot");
}
export function showSources(result) {
  if (result.scope !== "public_web" || !result.ok) return;
  $("sources-panel").open = true;
  setText("sources-summary", "Answer sources ({count})", { count: result.sources.length });
  $("sources").replaceChildren();
  $("source-status").textContent = `${t(result.cached ? "Cached evidence" : "Retrieved evidence")} / ${result.retrieved_at}`;
  for (const source of result.sources) {
    const url = new URL(source.url);
    if (url.protocol !== "https:" || url.username || url.password) continue;
    const li = document.createElement("li");
    const link = document.createElement("a");
    link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer";
    link.textContent = `${source.id}: ${source.title}`;
    const text = document.createElement("p");
    text.textContent = source.excerpt;
    li.append(link, text); $("sources").append(li);
  }
}
export function connectControls(info) {
  if (!webiqPreferenceLoaded) {
    webiqPreferenceLoaded = true;
    try {
      const saved = localStorage.getItem(webiqStorageKey);
      if (saved !== null && saved !== "true" && saved !== "false") throw new Error("Saved Web IQ preference is invalid. Using the default enabled setting.");
      webiqRequested = saved !== "false";
    } catch (error) { report(`Web IQ preference could not be restored: ${error.message}`); }
  }
  contracts = info.contracts;
  localPhone.configure(contracts.find((tool) => tool.name === "control_phone").parameters.properties.contact.enum);
  if (!$("phone-contact").options.length) {
    for (const contact of localPhone.contacts) {
      const option = document.createElement("option");
      option.value = contact; option.textContent = contact; $("phone-contact").append(option);
    }
    renderAddressBook();
  }
  const simSpec = contracts.find((tool) => tool.name === "control_autopilot").parameters.properties;
  autopilot.limits = {
    speed: [simSpec.target_speed_kmh.minimum, simSpec.target_speed_kmh.maximum],
    gap: [simSpec.following_gap.minimum, simSpec.following_gap.maximum],
  };
  for (const [id, spec] of [
    ["sim-speed", simSpec.target_speed_kmh], ["sim-gap", simSpec.following_gap],
    ["climate-fan", contracts.find((t) => t.name === "set_climate").parameters.properties.fan],
    ["cluster-brightness", contracts.find((t) => t.name === "set_cluster_preferences").parameters.properties.brightness],
  ]) { $(id).min = spec.minimum; $(id).max = spec.maximum; }
  if (channel && channel.readyState < WebSocket.CLOSING) return;
  $("control-status").textContent = "Connecting controls";
  $("reconnect-controls").hidden = true;
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/control`);
  channel = ws;
  ws.onmessage = async (event) => {
    if (channel !== ws) return;
    try {
      lastControlContact = performance.now();
      const packet = JSON.parse(event.data);
      if (packet.type === "control_ready") {
        epoch = packet.epoch;
        const preferred = webiqRequested;
        applyWebIQState(packet.grounding);
        void setWebIQEnabled(preferred).catch((error) => { report(error.message); channel?.close(); });
        autopilot.setConditions({ connected: true });
        phoneTick = performance.now(); localPhone.setConnected(true); renderPhone();
        setText("control-status", "Controls connected");
        document.dispatchEvent(new CustomEvent("cockpit-snapshot", { detail: packet.state }));
        publish("media"); publish("autopilot"); publish("phone"); renderLink();
        document.dispatchEvent(new CustomEvent("cockpit-link", { detail: { owner: epoch } }));
      } else if (packet.type === "webiq_state") {
        applyWebIQState(packet.grounding);
        const request = pending.get(packet.id);
        if (request) {
          clearTimeout(request.timeout); pending.delete(packet.id);
          try { localStorage.setItem(webiqStorageKey, String(packet.grounding.requested)); }
          catch (error) { report(`Web IQ is set for this session, but the preference could not be saved: ${error.message}`); }
          request.resolve(packet.grounding);
        }
      } else if (packet.type === "browser_command") {
        if (packet.epoch !== epoch) throw new Error("Stale browser owner.");
        if (recent.has(packet.id)) { send(recent.get(packet.id)); return; }
        const domain = { control_autopilot: "autopilot", control_media: "media", control_phone: "phone" }[packet.name];
        let receipt;
        try {
          if (!domain) throw new Error("Unsupported browser command.");
          if (domain === "autopilot") {
            autopilot.setConditions({ bodyReady: packet.body_ready, visible: !document.hidden });
          }
          if (domain === "phone") advancePhone();
          const state = domain === "autopilot"
            ? autopilot.command(packet.arguments, packet.revision ?? autopilot.state.rev)
            : domain === "phone" ? localPhone.command(packet.arguments, packet.revision ?? localPhone.state.rev)
              : await localMedia.command(packet.arguments);
          if (domain === "phone") renderPhone();
          receipt = { type: "browser_receipt", epoch, id: packet.id, domain, ok: true, state };
        } catch (e) {
          receipt = { type: "browser_receipt", epoch, id: packet.id, domain, ok: false, error: e.message };
        }
        if (recent.size >= 1000) recent.delete(recent.keys().next().value);
        recent.set(packet.id, receipt); send(receipt);
      } else if (packet.type === "command_result") {
        const request = pending.get(packet.id);
        if (request) {
          clearTimeout(request.timeout); pending.delete(packet.id);
          request.resolve(packet);
        }
      } else if (packet.type === "snapshot") {
        document.dispatchEvent(new CustomEvent("cockpit-snapshot", { detail: packet.state }));
      } else if (packet.type === "control_error") {
        throw new Error(packet.message);
      }
    } catch (e) { report(e.message); channel?.close(); }
  };
  ws.onclose = () => {
    if (channel !== ws) return;
    epoch = null; recent.clear();
    autopilot.setConditions({ connected: false });
    advancePhone(); localPhone.setConnected(false); renderPhone();
    localMedia.audio.pause();
    for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(new Error("Controls disconnected; completion is unknown.")); }
    pending.clear();
    renderWebIQ();
    setText("control-status", "Controls disconnected / assistance off");
    $("reconnect-controls").hidden = false;
    renderLink();
    document.dispatchEvent(new CustomEvent("cockpit-link", { detail: { owner: null } }));
  };
  ws.onerror = () => { if (channel === ws) report("Cockpit control connection failed."); };
  $("reconnect-controls").onclick = () => connectControls({ ...info, state: sharedState || info.state });
}

async function invoke(button, name, args) {
  button.dataset.busy = "true";
  button.disabled = true;
  let failure = "";
  document.dispatchEvent(new CustomEvent("cockpit-action", { detail: { id: button.id, name, busy: true } }));
  try {
    const packet = await command(name, args);
    document.dispatchEvent(new CustomEvent("cockpit-snapshot", { detail: packet.state }));
    document.dispatchEvent(new CustomEvent("cockpit-result", { detail: { name, result: packet.result } }));
    if (!packet.result.ok) throw new Error(packet.result.error);
  } catch (e) { failure = e.message; report(e.message); }
  finally {
    delete button.dataset.busy; button.disabled = false;
    document.dispatchEvent(new CustomEvent("cockpit-action", { detail: { id: button.id, name, busy: false, error: failure } }));
    if (name === "control_phone") renderPhone();
  }
}
for (const action of ["engage", "disengage"]) {
  $(`sim-${action}`).onclick = (event) => invoke(event.currentTarget, "control_autopilot", { action });
}
for (const [id, key] of [["sim-speed", "target_speed_kmh"], ["sim-gap", "following_gap"], ["sim-lane", "lane_keeping"]]) {
  $(id).onchange = (event) => invoke(event.currentTarget, "control_autopilot", {
    action: "update", [key]: key === "lane_keeping" ? $(id).checked : Number($(id).value),
  });
}
$("sim-speed").oninput = () => { $("sim-target-value").textContent = `${$("sim-speed").value} km/h`; };
$("sim-gap").oninput = () => { $("sim-gap-value").textContent = $("sim-gap").value; };
$("sim-scenario").onchange = () => {
  try { autopilot.scenario($("sim-scenario").value); publish("autopilot"); } catch (e) { report(e.message); }
};
$("sim-acknowledge").onclick = () => {
  try { autopilot.acknowledge(); publish("autopilot"); } catch (e) { report(e.message); }
};
$("media-file").onchange = () => {
  if (!$("media-file").files.length) return;
  try {
    const file = $("media-file").files[0];
    localMedia.select(file);
    clearTextBinding("media-track");
    $("media-track").textContent = file.name;
    setText("media-source", "Your library · on this device");
    $("media-demo").setAttribute("aria-pressed", "false");
    selectedTrack = null;
    trackSwitch++;
    $("media-preset").value = "";
  }
  catch (e) { report(e.message); }
};
function renderMedia() {
  const state = localMedia.snapshot();
  document.querySelector(".media-card").dataset.playing = String(state.playing);
  setText("media-availability", state.available ? state.playing ? "NOW PLAYING" : "AUDIO READY"
    : localMedia.audio.error ? "AUDIO ERROR" : localMedia.url ? "LOADING AUDIO" : "NO AUDIO SOURCE");
  for (const id of ["media-play", "media-pause", "media-mute", "media-unmute", "media-position"]) $(id).disabled = !state.available || Boolean($(id).dataset.busy);
  $("media-play").hidden = state.playing;
  $("media-pause").hidden = !state.playing;
  $("media-mute").hidden = state.muted;
  $("media-unmute").hidden = !state.muted;
  $("media-position").max = state.duration_seconds;
  $("media-position").style.setProperty("--played", `${state.duration_seconds ? state.position_seconds / state.duration_seconds * 100 : 0}%`);
  if (document.activeElement !== $("media-position")) $("media-position").value = state.position_seconds;
  const duration = (value) => `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, "0")}`;
  $("media-elapsed").textContent = duration(state.position_seconds);
  $("media-duration").textContent = duration(state.duration_seconds);
}
for (const event of ["loadedmetadata", "play", "pause", "ended", "seeked", "volumechange", "emptied", "error"]) {
  localMedia.audio.addEventListener(event, () => {
    renderMedia();
    publish("media");
    if (event === "error") report("Selected audio cannot be decoded. Choose another supported file.");
  });
}
localMedia.audio.addEventListener("timeupdate", renderMedia);
renderMedia();
const demoTracks = new Map();
let selectedTrack = "evening";
let trackSwitch = 0;
function renderTrackOptions() {
  $("media-preset").replaceChildren(...DEMO_TRACKS.map((track) => {
    const option = document.createElement("option");
    option.value = track.id; option.textContent = t(track.title);
    return option;
  }));
  $("media-preset").value = selectedTrack || "";
}
renderTrackOptions();
async function loadDemoTrack(id = "evening", resume = false) {
  const track = DEMO_TRACKS.find((item) => item.id === id);
  if (!track) throw new Error("Unknown AURA music preset.");
  const revision = ++trackSwitch;
  if (!demoTracks.has(id)) demoTracks.set(id, createDemoTrack(id));
  localMedia.select(demoTracks.get(id), true);
  selectedTrack = id;
  $("media-preset").value = id;
  setText("media-track", track.title);
  setText("media-source", "AURA original · continuous mix");
  $("media-demo").setAttribute("aria-pressed", String(id === "evening"));
  $("media-file").value = "";
  renderMedia();
  publish("media");
  if (resume) {
    try { await localMedia.audio.play(); }
    catch (error) {
      if (error.name === "AbortError" && (revision !== trackSwitch || localMedia.audio.paused)) return;
      throw error;
    }
  }
}
$("media-demo").onclick = () => {
  void loadDemoTrack("evening", !localMedia.audio.paused).catch((e) => report(`Demo audio could not load: ${e.message}`));
};
function switchTrack(id) {
  void loadDemoTrack(id, !localMedia.audio.paused).catch((e) => report(`Demo audio could not load: ${e.message}`));
}
$("media-preset").onchange = () => switchTrack($("media-preset").value);
for (const [id, direction] of [["media-previous", -1], ["media-next", 1]]) {
  $(id).onclick = () => {
    const index = DEMO_TRACKS.findIndex((track) => track.id === selectedTrack);
    const next = index < 0 ? (direction > 0 ? 0 : DEMO_TRACKS.length - 1) : (index + direction + DEMO_TRACKS.length) % DEMO_TRACKS.length;
    switchTrack(DEMO_TRACKS[next].id);
  };
}
void loadDemoTrack().catch((e) => report(`Demo audio could not load: ${e.message}`));
for (const action of ["play", "pause", "mute", "unmute"]) {
  $(`media-${action}`).onclick = (event) => invoke(event.currentTarget, "control_media", { action });
}
$("media-position").onchange = (event) => invoke(event.currentTarget, "control_media", {
  action: "seek", position_seconds: Number($("media-position").value),
});
function bind(id, name, makeArgs) { $(id).onchange = (event) => invoke(event.currentTarget, name, makeArgs()); }
bind("climate-fan", "set_climate", () => ({ fan: Number($("climate-fan").value) }));
for (const key of ["power", "ac", "auto", "recirculation", "defrost"]) {
  bind(`climate-${key}`, "set_climate", () => ({ [key]: $(`climate-${key}`).checked }));
}
for (const key of ["avoid_tolls", "avoid_highways"]) bind(`nav-${key}`, "set_navigation_preferences", () => ({ [key]: $(`nav-${key}`).checked }));
$("climate-temperature").onchange = (event) => invoke(event.currentTarget, "set_climate", { temperature_c: Number(event.currentTarget.value) });
$("nav-clear").onclick = (event) => invoke(event.currentTarget, "clear_destination", {});
for (const key of ["units", "theme", "layout", "brightness"]) bind(`cluster-${key}`, "set_cluster_preferences",
  () => ({ [key]: key === "brightness" ? Number($(`cluster-${key}`).value) : $(`cluster-${key}`).value }));
bind("assist-detail", "set_assist_preferences", () => ({ detail: $("assist-detail").value }));
bind("assist-tips", "set_assist_preferences", () => ({ tips: $("assist-tips").checked }));
bind("phone-notifications", "set_phone_preferences", () => ({ notifications: $("phone-notifications").checked }));
bind("phone-detail", "set_phone_preferences", () => ({ detail: $("phone-detail").value }));
function advancePhone() {
  const now = performance.now();
  localPhone.advance(Math.max(0, now - phoneTick) / 1000);
  phoneTick = now;
}
function renderPhone() {
  const state = localPhone.snapshot(), phase = state.call_state;
  const ongoing = ["dialing", "incoming", "active"].includes(phase);
  $("phone-call-panel").dataset.callState = phase;
  setText("phone-summary", ongoing ? phase.toUpperCase() : state.available ? "READY" : "DISCONNECTED");
  $("phone-person").textContent = state.contact || t("Ready to call");
  $("phone-avatar").textContent = state.contact ? state.contact.split(" ").map((word) => word[0]).join("") : "PH";
  const status = !state.available ? "Controls disconnected" : {
    idle: "Ready to call", dialing: "Dialing", incoming: "Incoming call",
    active: state.muted ? "Call active / muted" : "Call active", ended: state.reason,
  }[phase];
  setText("phone-state", status || "Ready to call");
  $("phone-duration").textContent = `${Math.floor(state.duration_seconds / 60)}:${String(state.duration_seconds % 60).padStart(2, "0")}`;
  $("phone-form").hidden = ongoing;
  $("phone-contact").disabled = !state.available || ongoing;
  for (const [id, visible] of [
    ["phone-call", !ongoing], ["phone-incoming", !ongoing], ["phone-answer", phase === "incoming"],
    ["phone-reject", phase === "incoming"], ["phone-end", ["dialing", "active"].includes(phase)],
    ["phone-mute", phase === "active" && !state.muted], ["phone-unmute", phase === "active" && state.muted],
  ]) {
    $(id).hidden = !visible;
    $(id).disabled = !state.available || !visible || Boolean($(id).dataset.busy);
  }
  for (const button of $("phone-contacts").querySelectorAll("button")) {
    button.disabled = !state.available || ongoing || Boolean($("phone-call").dataset.busy);
    button.setAttribute("aria-pressed", String(button.dataset.contact === $("phone-contact").value));
  }
}
function renderAddressBook() {
  const query = $("phone-search").value.trim().toLocaleLowerCase();
  $("phone-contacts").replaceChildren();
  const contacts = localPhone.contacts.filter((contact) => contact.toLocaleLowerCase().includes(query));
  setText("phone-contact-count", "{count} contacts", { count: localPhone.contacts.length });
  $("phone-no-results").hidden = contacts.length > 0;
  for (const contact of contacts) {
    const button = document.createElement("button");
    button.type = "button"; button.dataset.contact = contact;
    const initials = document.createElement("span"), name = document.createElement("strong"), label = document.createElement("small");
    initials.className = "contact-avatar"; initials.textContent = contact.split(" ").map((word) => word[0]).join("");
    name.textContent = contact; label.textContent = t("Contact / select");
    const detail = document.createElement("span"); detail.append(name, label);
    button.append(initials, detail);
    button.onclick = () => { $("phone-contact").value = contact; renderPhone(); $("phone-call").focus(); };
    $("phone-contacts").append(button);
  }
  renderPhone();
}
$("phone-search").oninput = renderAddressBook;
$("phone-contact").onchange = renderPhone;
$("phone-form").onsubmit = (event) => {
  event.preventDefault();
  void invoke($("phone-call"), "control_phone", { action: "dial", contact: $("phone-contact").value });
};
for (const [id, action] of [["phone-answer", "answer"], ["phone-reject", "reject"], ["phone-end", "end"], ["phone-mute", "mute"], ["phone-unmute", "unmute"]]) {
  $(id).onclick = () => invoke($(id), "control_phone", { action });
}
$("phone-incoming").onclick = () => {
  try {
    advancePhone(); localPhone.incoming($("phone-contact").value); renderPhone(); publish("phone");
  } catch (e) { report(e.message); }
};
renderPhone();
document.addEventListener("visibilitychange", () => {
  autopilot.setConditions({ visible: !document.hidden });
  publish("autopilot");
});
window.addEventListener("pagehide", () => { autopilot.halt("Page closed"); localMedia.close(); localPhone.setConnected(false); channel?.close(); });
setInterval(() => {
  advancePhone(); renderPhone();
  if (!epoch) return;
  if (performance.now() - lastControlContact > 5000) {
    autopilot.setConditions({ connected: false });
    report("Cockpit heartbeat lost. Assistance disengaged; reconnect controls explicitly.");
    channel?.close();
    return;
  }
  send({ type: "ping" }); publish("autopilot"); publish("media"); publish("phone");
}, 1000);

let previous = performance.now(), lastRevision = -1;
function frame(time) {
  autopilot.advance(Math.min(.1, Math.max(0, (time - previous) / 1000)), driveClock?.sample(time));
  previous = time;
  const s = autopilot.snapshot();
  const reference = motionSource.value === "reference";
  $("sim-state").textContent = `${t(s.mode.replaceAll("_", " "))} / ${t(reference ? "EPA loop playing" : "assisted driving")}`;
  const takeover = ["takeover_required", "fault"].includes(s.mode);
  const healthy = autopilot.connected && autopilot.visible && autopilot.bodyReady;
  setText("sim-warning", s.reason ? "{reason}. EPA playback continues." : reference
    ? "EPA cycle plays automatically. Engage Autopilot to take over speed."
    : "Autopilot controls speed and lane assistance. Disengage to return to EPA.", { reason: t(s.reason || "") });
  setText("sim-speed-readout", reference ? "EPA FTP-75 / AUTO LOOP" : "TARGET {speed} KM/H", { speed: s.target_speed_kmh });
  const trace = driveClock?.sample(time);
  const clock = (seconds) => `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
  $("sim-gap-readout").textContent = reference && trace
    ? `${clock(trace.cycleSeconds)} / ${clock(trace.durationSeconds)} / ${t("playing")}`
    : t("Lead vehicle {distance} m ahead", { distance: s.lead_distance_m.toFixed(0) });
  $("sim-engage").hidden = s.mode === "active";
  $("sim-disengage").hidden = s.mode !== "active";
  for (const [id, disabled] of [["sim-engage", !healthy || takeover]]) {
    $(id).disabled = disabled || Boolean($(id).dataset.busy);
  }
  $("sim-acknowledge").hidden = !takeover;
  $("sim-acknowledge").disabled = !takeover || s.scenario !== "clear" || !healthy;
  $("sim-panel").dataset.mode = s.mode;
  if (s.rev !== lastRevision) {
    lastRevision = s.rev;
    for (const [id, value] of [["sim-speed", s.target_speed_kmh], ["sim-gap", s.following_gap]]) {
      if (document.activeElement !== $(id)) $(id).value = value;
    }
    if (document.activeElement !== $("sim-lane")) $("sim-lane").checked = s.lane_keeping;
    $("sim-target-value").textContent = `${$("sim-speed").value} km/h`;
    $("sim-gap-value").textContent = $("sim-gap").value;
    publish("autopilot");
  }
  requestAnimationFrame(frame);
  document.addEventListener("ui-language-change", () => {
    renderWebIQ(); renderLink(); renderMedia(); renderTrackOptions(); renderAddressBook();
    if (sharedState) applySnapshot(sharedState);
  });
}
requestAnimationFrame(frame);
