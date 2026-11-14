// Run in a loaded cockpit page with agent-browser eval --stdin.
(async () => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const $ = (selector) => document.querySelector(selector);
  const wait = () => new Promise((resolve) => setTimeout(resolve, 30));
  const button = $("#connect");
  const card = $(".assistant-card");
  const orb = $(".voice-orb");
  const inspector = $(".pipeline-inspector");
  const { processEvent } = await import("/static/app.js");
  const { browserOwner, waitForWebIQPreference } = await import("/static/cockpit.js");
  const controlsDeadline = performance.now() + 10000;
  while (!browserOwner() && performance.now() < controlsDeadline) await wait();
  assert(browserOwner(), "Cockpit controls connect before voice-state tests");
  await waitForWebIQPreference();
  assert(document.title === "Azure Voice Agent for Cars / AURA", "Browser title");
  assert($("h1").textContent === "Azure Voice Agent for Cars", "Banner title");
  assert($(".assistant-card #reconnect-controls"), "Reconnect is accessible beside the voice link");
  assert($("header .process-card"), "Pipeline must be in the banner");
  assert($(".page-heading .process-card .local-badge .status-dot"), "Pipeline and connection lamp share the heading status area");
  assert($(".process-card").checkVisibility(), "Compact pipeline stays visible beside the title");
  assert(!inspector.open, "Inspector starts collapsed");
  assert($(".site-header").getBoundingClientRect().height < 350, "Compact header height");
  assert(document.documentElement.scrollWidth <= innerWidth, "No horizontal overflow");
  for (const selector of ["#media-demo", ".file-picker", "#media-play"]) {
    const control = $(selector).getBoundingClientRect(), panel = $("#media-title").closest(".card").getBoundingClientRect();
    assert(control.left >= panel.left && control.right <= panel.right && control.bottom <= panel.bottom, `Media source and playback controls fit: ${selector}`);
  }
  assert($(".cockpit-grid").children.length === 5 && document.querySelectorAll(".cockpit-grid > section.card").length === 5, "Five primary panels form the unified cockpit");
  assert($("#sim-panel #car-view") && !$("#sim-scene"), "Autopilot uses the main 3D vehicle, not a second toy-car canvas");
  assert($("#sim-panel #cluster-readout") && $("#sim-panel #cluster-units"), "Instruments and their preferences are merged into Autopilot");
  assert($(".assistant-card #activity") && $(".assistant-card #clear-log"), "Conversation and actions are inside Azure Voice Agent");
  assert($("#sim-panel .navigation-card #nav-form"), "Navigation is merged into Autopilot controls");
  assert($(".cockpit-grid > .phone-card #phone-title") && $(".assistant-card #sources"), "Phone has a dedicated primary card; sources stay in the voice panel");
  assert($("#phone-search") && $("#phone-contacts") && $("#phone-incoming"), "Address book and simulated calling are accessible");
  assert(!$("#sim-resume") && !$("#sim-pause") && !$("#motion-source"), "No scene-start, pause, resume or source-selection prerequisite");
  for (const selector of ["#connect", "#sim-engage", "#sim-warning", ".drive-setting > span", ".file-picker", "#destination-input", ".nav-go", ".fan-control"]) {
    assert(parseFloat(getComputedStyle($(selector)).fontSize) >= 14, `Projection-readable controls: ${selector}`);
  }
  for (const selector of [".card .eyebrow", ".card .scope-note", ".voice-link", ".process-steps strong", ".mode-toggle span", ".model-status", "#nav-status", "#nav-confirmation"]) {
    assert(parseFloat(getComputedStyle($(selector)).fontSize) >= 12, `Readable supporting text: ${selector}`);
  }
  assert(parseFloat(getComputedStyle($("#cluster-speed")).fontSize) >= 48, "One large 48px+ speed readout");
  if (innerWidth > 1100 && innerHeight >= 720) {
    assert(document.documentElement.scrollHeight <= innerHeight + 2, "Default desktop cockpit fits one screen");
    assert($(".process-card").getBoundingClientRect().left > $("h1").getBoundingClientRect().right, "Pipeline is to the right of the main title");
    for (const panel of document.querySelectorAll(".cockpit-grid > .card")) {
      assert(panel.scrollHeight <= panel.clientHeight + 2, `Default panel content is not clipped: ${panel.className}`);
    }
  }
  assert($(".process-steps").children.length === 6, "All six pipeline stages preserved");
  inspector.open = true;
  processEvent({ turn: 1, stage: "searching", detail: "Searching local tools", arguments: '{"query":"temperature"}' });
  assert($('[data-step="searching"]').dataset.state === "active", "Search stage active");
  assert($("#process-query").textContent.includes("temperature"), "Search request retained");
  processEvent({ turn: 1, stage: "discovered", detail: "Tool found", result: {
    ok: true, matches: [{ name: "get_vehicle_status", description: "Read vehicle state", parameters: {} }],
  } });
  assert($("#process-matches summary").textContent === "get_vehicle_status", "Expandable tool schema retained");
  processEvent({ turn: 1, stage: "executing", detail: "Executing", name: "get_vehicle_status", arguments: "{}" });
  processEvent({ turn: 1, stage: "result", detail: "Done", name: "get_vehicle_status", result: { ok: true } });
  processEvent({ turn: 1, stage: "complete", detail: "Response ready" });
  assert($("#process-pill").textContent.includes("RESPONSE READY"), "Pipeline completion retained");
  const popover = $(".pipeline-popover").getBoundingClientRect();
  assert(popover.left >= 0 && popover.right <= innerWidth + 1 && popover.bottom <= innerHeight + 1, "Request inspector stays inside the viewport");
  inspector.open = false;
  const settings = $(".drive-options");
  const drivingPanel = $("#sim-panel");
  const originalScroll = scrollY;
  settings.open = true;
  $("#cluster-brightness").focus();
  await wait();
  if (innerWidth > 1100 && innerHeight >= 720) {
    const control = $("#cluster-brightness").getBoundingClientRect();
    const bounds = drivingPanel.getBoundingClientRect();
    assert(control.top >= bounds.top && control.bottom <= bounds.bottom, "Expanded instrument settings can be reached inside the driving panel");
    assert(document.documentElement.scrollHeight <= innerHeight + 2, "Expanded settings do not lengthen the desktop page");
  }
  settings.open = false;
  drivingPanel.scrollTop = 0;
  const access = $(".vehicle-settings");
  access.open = true;
  $("#window-front_left").focus();
  await wait();
  assert(parseFloat(getComputedStyle($("#window-front_left")).fontSize) >= 14, "Expanded window controls remain readable");
  assert(parseFloat(getComputedStyle($("#window-front_left span")).fontSize) >= 12, "Window state labels remain readable");
  access.open = false;
  drivingPanel.scrollTop = 0;
  window.scrollTo(0, originalScroll);

  const originals = {
    AudioContext: window.AudioContext, AudioWorkletNode: window.AudioWorkletNode,
    WebSocket: window.WebSocket, getUserMedia: navigator.mediaDevices.getUserMedia,
    disabled: button.disabled,
  };
  const originalBackground = getComputedStyle(orb).backgroundImage;
  const node = () => ({ connect() {}, disconnect() {} });
  let socket;
  let holdMicrophone = false;
  let resolveMicrophone;
  const stream = { getTracks: () => [{ stop() {} }] };
  class TestContext {
    sampleRate = 24000;
    state = "running";
    currentTime = 0;
    destination = {};
    audioWorklet = { addModule: async () => {} };
    resume = async () => {};
    close = async () => {};
    createMediaStreamSource = node;
    createGain = () => ({ ...node(), gain: { value: 0 } });
  }
  class TestSocket {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    constructor() { socket = this; }
    send() {}
    close() { this.readyState = 3; this.onclose?.(); }
    message(data) { this.onmessage({ data: JSON.stringify(data) }); }
  }
  try {
    window.AudioContext = TestContext;
    window.AudioWorkletNode = class { port = {}; connect() {} disconnect() {} };
    window.WebSocket = TestSocket;
    navigator.mediaDevices.getUserMedia = () => holdMicrophone
      ? new Promise((resolve) => { resolveMicrophone = resolve; }) : Promise.resolve(stream);
    button.disabled = false;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    assert(getComputedStyle(button).animationName === (reduced ? "none" : "connectBreathe"), "Idle button breathing respects reduced motion");
    if (!reduced) {
      const animation = button.getAnimations()[0];
      animation.pause();
      animation.currentTime = 0;
      const dark = getComputedStyle(button).backgroundColor;
      animation.currentTime = 2400;
      assert(getComputedStyle(button).backgroundColor !== dark, "Button alternates dark and light");
      animation.play();
    }
    button.click();
    await wait();
    assert(card.classList.contains("connecting"), "Connection starts");
    assert(getComputedStyle(button).animationName === "none", "Breathing stops while connecting");
    assert(getComputedStyle(orb).backgroundImage === originalBackground, "Connecting orb stays purple");
    socket.message({ type: "ready", owner: browserOwner(), capabilities: ["control_autopilot"] });
    assert(card.classList.contains("connected"), "Ready state connected");
    assert($("#voice-link").dataset.linked === "true" && $("#sim-link").textContent === "VOICE LINKED", "Voice is linked to this browser scene");
    assert($("#header-connection").textContent === "VOICE LINKED", "Header lamp reports the actual voice link");
    assert(getComputedStyle(orb).backgroundImage !== originalBackground, "Connected orb becomes teal");
    assert($("#agent-visual").getAttribute("aria-label").includes("connected and active"), "Accessible connected label");
    assert(getComputedStyle(orb).animationName === (reduced ? "none" : "agentBreathe"), "Connected orb respects reduced motion");
    button.click();
    assert(!card.classList.contains("connected"), "Disconnect clears connected state");
    assert(getComputedStyle(orb).backgroundImage === originalBackground, "Disconnect restores purple");
    button.click();
    await wait();
    socket.message({ type: "error", message: "Test connection failure" });
    assert(!card.classList.contains("connecting") && !card.classList.contains("connected"), "Error clears connection state");
    assert(getComputedStyle(orb).backgroundImage === originalBackground, "Error restores purple");
    holdMicrophone = true;
    button.click();
    await wait();
    button.click();
    resolveMicrophone(stream);
    await wait();
    assert(!card.classList.contains("connecting"), "Cancelling microphone request restores idle state");
    assert($("#agent-visual").getAttribute("aria-label") === "AI agent disconnected", "Accessible disconnected label");
    holdMicrophone = false;
    button.click();
    await wait();
    socket.message({ type: "ready", owner: "another-browser", capabilities: ["control_autopilot"] });
    assert(!card.classList.contains("connected"), "A different browser owner cannot appear connected");
    assert($("#voice-link").dataset.linked === "false", "Wrong-owner voice link remains off");
    button.click();
    await wait();
    socket.message({ type: "ready", owner: browserOwner(), capabilities: ["control_autopilot"] });
    document.dispatchEvent(new CustomEvent("cockpit-link", { detail: { owner: null } }));
    assert(!card.classList.contains("connected") && socket.readyState === 3, "Control loss stops voice and microphone");
    assert(button.disabled, "Voice cannot reconnect until cockpit controls return");
  } finally {
    if (card.classList.contains("connected") || card.classList.contains("connecting")) button.click();
    window.AudioContext = originals.AudioContext;
    window.AudioWorkletNode = originals.AudioWorkletNode;
    window.WebSocket = originals.WebSocket;
    navigator.mediaDevices.getUserMedia = originals.getUserMedia;
    button.disabled = originals.disabled;
    $("#error").hidden = true;
  }
  return `UI checks passed at ${innerWidth}px (${matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduced" : "normal"} motion)`;
})()
