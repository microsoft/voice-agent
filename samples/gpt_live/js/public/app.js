// Browser side of the GPT Live sample: microphone in, teacher audio out, three text panes.
// The page only talks to the local server; the server holds the Azure credential.
import { PcmAudio } from "/pcm-audio.js";

const $ = (id) => document.getElementById(id);
const startButton = $("start");
const stopButton = $("stop");
const statusLine = $("status");
const panes = { teacher: $("teacher"), user: $("user") };
const delegationPane = $("delegation");
const delegations = new Map();
let socket;
let audio;
let microphone;
let lastRole;
let failed = false;

fetch("/config")
  .then((response) => response.json())
  .then((config) => {
    $("agent").textContent =
      `Agent ${config.agent}, version ${config.version} · ${config.delegation} delegation → ${config.backend}`;
  })
  .catch(() => {
    $("agent").textContent = "Could not read the agent configuration from the server.";
  });

function setStatus(text, error = false) {
  statusLine.textContent = text;
  statusLine.classList.toggle("error", error);
}

function scrollToEnd(element) {
  element.scrollTop = element.scrollHeight;
}

// Start a new paragraph whenever the other speaker talked in between.
function appendTranscript(role, delta) {
  const pane = panes[role];
  let paragraph = pane.lastElementChild;
  if (!paragraph || lastRole !== role) {
    paragraph = document.createElement("p");
    pane.append(paragraph);
  }
  lastRole = role;
  paragraph.textContent += delta;
  scrollToEnd(pane);
}

// One card per delegation: title, ID, latest status, and backend guidance text.
function updateDelegation({ id, title, status, delta }) {
  let item = delegations.get(id);
  if (!item) {
    const element = document.createElement("div");
    element.className = "delegation-item";
    item = {};
    for (const part of ["title", "id", "state", "text"]) {
      item[part] = document.createElement("div");
      item[part].className = part;
      element.append(item[part]);
    }
    item.id.textContent = id;
    delegationPane.append(element);
    delegations.set(id, item);
  }
  if (title) item.title.textContent = title;
  if (status) item.state.textContent = status;
  if (delta) item.text.textContent += delta;
  scrollToEnd(delegationPane);
}

async function handle(message) {
  switch (message.type) {
    case "status":
      setStatus(message.text);
      break;
    case "ready":
      setStatus("Ready. Speak into your microphone; click Stop to end the lesson.");
      await audio.startCapture(microphone, (chunk) => {
        if (socket?.readyState === WebSocket.OPEN) socket.send(chunk);
      });
      break;
    case "audio":
      audio.play(message.delta);
      break;
    case "transcript":
      appendTranscript(message.role, message.delta);
      break;
    case "delegation":
      updateDelegation(message);
      break;
    case "error":
      failed = true;
      setStatus(message.message, true);
      break;
    case "closed": {
      const summary = [
        message.closeReason ? `Session closed: ${message.closeReason}` : "Session ended",
        message.usageSeconds !== undefined ? `Live usage ${message.usageSeconds} s` : undefined,
        message.conversationId
          ? `Conversation id ${message.conversationId} (the server console prints a download command)`
          : undefined,
      ].filter(Boolean);
      setStatus(failed ? `${statusLine.textContent} ${summary.join(". ")}.` : `${summary.join(". ")}.`, failed);
      break;
    }
  }
}

function releaseMicrophone() {
  audio?.stopCapture();
  for (const track of microphone?.getTracks() ?? []) track.stop();
  microphone = undefined;
}

function finish() {
  releaseMicrophone();
  socket = undefined;
  startButton.disabled = false;
  stopButton.disabled = true;
}

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  failed = false;
  lastRole = undefined;
  delegations.clear();
  for (const pane of [...Object.values(panes), delegationPane]) pane.replaceChildren();
  // Create audio in the click handler so the browser allows playback; replace any
  // previous session's context only now, so its last reply could finish playing.
  audio?.close();
  audio = new PcmAudio();
  try {
    setStatus("Waiting for microphone permission…");
    microphone = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/live`);
    socket.binaryType = "arraybuffer";
    socket.addEventListener("message", (event) =>
      handle(JSON.parse(event.data)).catch((error) => {
        failed = true;
        setStatus(error.message, true);
        stopButton.click();
      }),
    );
    socket.addEventListener("close", finish);
    stopButton.disabled = false;
  } catch (error) {
    setStatus(error.message, true);
    finish();
  }
});

stopButton.addEventListener("click", () => {
  stopButton.disabled = true;
  releaseMicrophone();
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "stop" }));
    if (!failed) setStatus("Closing; waiting for session.closed…");
  }
});
