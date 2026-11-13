// Set window.voiceTestPcm to base64 24 kHz mono PCM16 speech before this paid cloud test.
(async () => {
  const { browserOwner, command, phoneSnapshot } = await import("/static/cockpit.js");
  const { autopilot } = await import("/static/autopilot-sim.mjs");
  const $ = (id) => document.getElementById(id);
  const assert = (value, message) => { if (!value) throw new Error(message); };
  assert(window.voiceTestPcm, "Provide synthetic speech; this test never uses the microphone.");
  const phoneMode = window.voiceTestMode === "phone";
  const cockpitMode = window.voiceTestMode === "cockpit";
  const webiqMode = window.voiceTestMode === "webiq" || window.voiceTestMode === "webiq_off";
  const webiqOff = window.voiceTestMode === "webiq_off";
  const expectedTool = webiqMode ? "ground_public_answer" : cockpitMode ? "edit_itinerary" : phoneMode ? "control_phone" : "control_autopilot";
  assert(!document.hidden, "Keep this test browser visible.");
  const original = { WebSocket: window.WebSocket, getUserMedia: navigator.mediaDevices.getUserMedia };
  const traces = [];
  let context, source, stream;
  let started = false;
  let completed = false;
  let failure = null;
  const waitFor = async (predicate, timeout = 90000) => {
    const deadline = performance.now() + timeout;
    while (!predicate()) {
      if (failure) throw new Error(failure);
      if (performance.now() > deadline) throw new Error(`Voice test timed out: ${JSON.stringify(traces)}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  try {
    await waitFor(() => browserOwner() && !$("connect").disabled, 15000);
    assert($("connection-pill").textContent === "AVAILABLE", "Use a fresh cloud cockpit without an active voice session.");
    window.WebSocket = class extends original.WebSocket {
      constructor(...args) {
        super(...args);
        if (new URL(args[0]).pathname !== "/ws") return;
        this.addEventListener("message", ({ data }) => {
          const packet = JSON.parse(data);
          if (packet.type === "ready") {
            assert(packet.owner === browserOwner(), "Cloud voice acknowledges this browser owner.");
            assert(packet.capabilities.includes(expectedTool) === !webiqOff, "Voice capabilities match this client's tool policy.");
          }
          if (packet.type === "tool") {
            completed = false;
            traces.push({ name: packet.name, result: packet.result });
          }
          if (packet.type === "transcript") traces.push({ role: packet.role, text: packet.text });
          if (packet.type === "transcript" && packet.role === "assistant" && /\bdemo\b|simulat|模拟|仿真/i.test(packet.text)) failure = `Non-operational agent wording: ${packet.text}`;
          if (packet.type === "error") failure = packet.message;
          if (packet.type === "process" && packet.stage === "complete") completed = true;
        });
      }
    };
    navigator.mediaDevices.getUserMedia = async () => {
      context = new AudioContext({ sampleRate: 24000 });
      await context.resume();
      const raw = Uint8Array.from(atob(window.voiceTestPcm), (value) => value.charCodeAt(0));
      const pcm = new DataView(raw.buffer);
      const buffer = context.createBuffer(1, raw.length / 2, 24000);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = pcm.getInt16(i * 2, true) / 32768;
      source = context.createBufferSource();
      source.buffer = buffer;
      const destination = context.createMediaStreamDestination();
      source.connect(destination);
      stream = destination.stream;
      return stream;
    };
    $("connect").click();
    await waitFor(() => $("voice-link").dataset.linked === "true");
    assert($("sim-link").textContent === "VOICE LINKED", "The scene shows its real voice link.");
    source.start(context.currentTime + .3);
    started = true;
    if (webiqMode) {
      await waitFor(() => completed && traces.some((event) => event.role === "assistant"));
      const lookups = traces.filter((event) => event.name === "ground_public_answer");
      if (webiqOff) {
        assert(lookups.length === 0, "Opt-out removes public lookup from the actual model turn");
        assert($("sources").children.length === 0, "Opt-out does not fabricate source links");
        const spoken = traces.filter((event) => event.role === "assistant").map((event) => event.text).join(" ");
        assert(/adaptive cruise control/i.test(spoken) && /speed|distance|gap/i.test(spoken), "With Web IQ off, the model directly explains adaptive cruise control from its knowledge");
        assert(!/cannot verify|can't verify|unable to verify|cannot answer|can't answer|(?:web lookup|browsing|Web\s?IQ).{0,40}(?:unavailable|disabled|off)/i.test(spoken), "Knowledge answers do not require grounding or a routine unavailable-web disclaimer");
      } else {
        assert(lookups.some((event) => event.result.ok && event.result.scope === "public_web"
          && event.result.sources.length > 0), "Azure voice receives actual cited Web IQ evidence");
        assert(lookups.some((event) => event.result.ok && event.result.instruction.includes("Never read source IDs")), "Live grounding provider uses the spoken source-name policy");
        assert($("sources").children.length > 0 && $("sources-panel").open, "Real public source links appear in the cockpit");
        const spoken = traces.filter((event) => event.role === "assistant").map((event) => event.text).join(" ");
        assert(!/\bS(?:\s*\d+|\s+(?:one|two|three))\b|\[\s*\d+\s*\]|https?:\/\/|www\./i.test(spoken), "Speech does not read citation IDs, markers or URLs");
        assert(!/^(?:according to|here(?:'s| is) what I found|I (?:searched|checked|found))/i.test(spoken), "Speech starts with the answer without repeating the search transition or adding a source preamble");
      }
      assert(!traces.some((event) => event.role === "assistant" && /demo|simulat|模拟|仿真/i.test(event.text)), "Public answers use operational wording");
      return { passed: true, path: webiqOff ? "Azure speech/model -> knowledge-only prompt -> direct answer without web lookup"
        : "Azure speech/model -> Web IQ MCP -> cited evidence -> source links", traces };
    }
    if (cockpitMode) {
      await waitFor(() => completed && traces.some((event) => event.role === "assistant"));
      const climate = await command("read_vehicle", { domain: "climate" });
      const navigation = await command("read_vehicle", { domain: "navigation" });
      assert(climate.result.ok && navigation.result.ok, "Read back actual voice control results");
      assert(climate.result.data.temperature_c === 22 && climate.result.data.fan === 4, "Speech sets cabin temperature and airflow");
      const stops = navigation.result.data.stops;
      assert(stops.length === 2 && stops[0].toLowerCase() === "central library"
        && stops[1].toLowerCase() === "riverside park", "Speech preserves both destinations in requested order");
      assert(traces.some((event) => event.name === "set_climate" && event.result.ok)
        && traces.filter((event) => event.name === "edit_itinerary" && event.result.ok).length === 2, "Voice uses confirmed climate and ordered-stop receipts");
      assert($("temperature").textContent === "22" && $("climate-fan-value").textContent === "4"
        && $("nav-stops").children.length === 2, "Visible controls reflect the spoken request");
      assert(!traces.some((event) => event.role === "assistant" && /\bdemo\b|simulat|模拟|仿真/i.test(event.text)), "Agent uses operational wording");
      return { passed: true, path: "synthetic speech -> Azure speech/model -> climate + ordered itinerary -> receipts -> UI", traces, climate: climate.result.data, navigation: navigation.result.data };
    }
    if (phoneMode) {
      await waitFor(() => completed && phoneSnapshot().call_state === "active");
      assert(phoneSnapshot().contact === "Alex Chen", "Speech selects the requested demo contact.");
      assert(traces.some((event) => event.name === "control_phone" && event.result.ok
        && event.result.scope === "browser_phone" && event.result.data.call_state === "dialing"
        && event.result.data.contact === "Alex Chen"), "Voice receives a confirmed local dialing receipt.");
      assert(!traces.some((event) => event.role === "assistant" && /simulat|demo call/i.test(event.text)), "Voice uses normal call confirmations.");
      assert($("phone-person").textContent === "Alex Chen" && $("phone-state").textContent.includes("Call active"), "Voice drives the caller card.");
      return { passed: true, path: "synthetic MediaStream -> AudioWorklet -> Azure speech/model -> control_phone -> receipt -> caller card", traces, phone: phoneSnapshot() };
    }
    await waitFor(() => completed && autopilot.state.mode === "active");
    await waitFor(() => autopilot.state.mode === "active" && autopilot.state.actual_speed_kmh > 0, 5000);
    assert(autopilot.state.running && autopilot.state.target_speed_kmh === 40, "Speech controls the actual scene at 40 km/h.");
    const receipts = traces.filter((event) => event.name === "control_autopilot" && event.result.ok);
    assert(receipts.some((event) => event.result.data.mode === "active" && event.result.data.target_speed_kmh === 40), "Engage receipt confirms the requested target.");
    assert(!traces.some((event) => event.role === "assistant" && /simulat|scene|resume/i.test(event.text)), "Direct control confirmation does not introduce scene playback or a resume prerequisite.");
    assert($("sim-state").textContent.includes("active"), "Actual scene UI follows the voice command.");
    return { passed: true, path: "synthetic MediaStream -> AudioWorklet -> public voice socket -> Azure speech/model -> browser command -> receipt -> UI", traces, scene: autopilot.snapshot() };
  } finally {
    if (document.querySelector(".assistant-card").matches(".connected, .connecting")) $("connect").click();
    try {
      if (phoneMode && ["dialing", "incoming", "active"].includes(phoneSnapshot().call_state)) {
        const ended = await command("control_phone", { action: "end" });
        assert(ended.result.ok, "Voice test cleans up its own demo call.");
      }
    } finally {
      if (started) source.stop();
      stream?.getTracks().forEach((track) => track.stop());
      if (context) await context.close();
      navigator.mediaDevices.getUserMedia = original.getUserMedia;
      window.WebSocket = original.WebSocket;
      delete window.voiceTestPcm;
      delete window.voiceTestMode;
      if (!phoneMode) autopilot.halt("Voice acceptance finished");
    }
  }
})()
