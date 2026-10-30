// Run on an isolated cockpit; no microphone, phone provider or real calls are used.
(async () => {
  const { command, phoneSnapshot } = await import("/static/cockpit.js");
  const $ = (id) => document.getElementById(id);
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const waitFor = async (predicate) => {
    for (let i = 0; i < 200; i++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Phone browser condition timed out.");
  };
  const execute = async (args, ok = true) => {
    const packet = await command("control_phone", args);
    assert(packet.result.ok === ok, JSON.stringify(packet.result));
    return packet.result;
  };
  await waitFor(() => phoneSnapshot().available && $("control-status").textContent === "Controls connected");
  const panel = document.querySelector(".phone-card");
  assert($("phone-contact").options.length === 3, "Listed contacts come from the tool contract");
  assert(!phoneSnapshot().connected && !phoneSnapshot().calling_available, "Real calling and Bluetooth are never claimed");
  assert(!/simulat|demo|no real calls/i.test(panel.textContent), "Phone panel uses normal operational wording");
  const addressBook = document.querySelector(".phone-address-book");
  addressBook.open = true;
  $("phone-search").value = "maya";
  $("phone-search").dispatchEvent(new Event("input"));
  assert($("phone-contacts").children.length === 1 && $("phone-contacts").textContent.includes("Maya Singh"), "Address book filters contacts");
  $("phone-contacts").querySelector("button").click();
  assert($("phone-contact").value === "Maya Singh", "Address book selection updates the call target");
  $("phone-search").value = "not a contact";
  $("phone-search").dispatchEvent(new Event("input"));
  assert(!$("phone-no-results").hidden && !$("phone-contacts").children.length, "Unknown contact is explicit, not silently substituted");
  $("phone-search").value = "";
  $("phone-search").dispatchEvent(new Event("input"));
  assert($("phone-contacts").children.length === 3, "Address book restores all fixture contacts");
  addressBook.open = false;
  panel.scrollTop = 0;
  $("phone-contact").value = "Alex Chen";
  $("phone-form").dispatchEvent(new Event("submit", { cancelable: true }));
  await waitFor(() => phoneSnapshot().call_state === "dialing");
  assert($("phone-person").checkVisibility() && $("phone-person").textContent === "Alex Chen", "Manual call updates the always-visible caller card");
  assert($("phone-summary").textContent === "DIALING", "Dialing is visible");
  await waitFor(() => phoneSnapshot().call_state === "active");
  await waitFor(() => phoneSnapshot().duration_seconds >= 1);
  assert($("phone-state").textContent.includes("Call active"), "Active state is visible");
  const read = await command("read_vehicle", { domain: "phone", fields: ["call_state", "contact", "connected", "calling_available"] });
  assert(read.result.data.call_state === "active" && read.result.data.contact === "Alex Chen", "Voice reads the owning browser's actual call");
  const publicState = await (await fetch("/api/state")).json();
  assert(publicState.state.domains.phone.call_state === "idle", "An unowned snapshot cannot leak another browser's call");
  await execute({ action: "mute" });
  assert(phoneSnapshot().muted && $("phone-state").textContent.includes("muted"), "Tool mute updates the visible caller card");
  $("phone-unmute").click();
  await waitFor(() => !phoneSnapshot().muted);
  $("phone-end").click();
  await waitFor(() => phoneSnapshot().call_state === "ended" && !$("phone-call").disabled);
  await execute({ action: "answer" }, false);
  $("phone-contact").value = "Maya Singh";
  $("phone-incoming").click();
  assert(phoneSnapshot().call_state === "incoming" && !$("phone-answer").hidden, "Explicit incoming-demo action");
  await execute({ action: "answer" });
  assert(phoneSnapshot().call_state === "active" && phoneSnapshot().direction === "incoming", "Voice answer uses the actual incoming call");
  await execute({ action: "end" });
  $("phone-incoming").click();
  $("phone-reject").click();
  await waitFor(() => phoneSnapshot().reason === "Call declined" && !$("phone-call").disabled);
  const dial = await execute({ action: "dial", contact: "Jordan Lee" });
  assert(dial.scope === "browser_phone", "Call result identifies the owning phone domain");
  await execute({ action: "end" });
  for (const button of panel.querySelectorAll("button,select")) {
    if (button.checkVisibility()) assert(parseFloat(getComputedStyle(button).fontSize) >= 14, "Readable phone controls");
  }
  assert(document.documentElement.scrollWidth <= innerWidth, "Phone controls do not overflow horizontally");
  addressBook.open = false;
  if (innerWidth > 1100 && innerHeight >= 720) assert(document.documentElement.scrollHeight <= innerHeight + 2, "Default desktop still fits one screen");
  return `PASS: phone UI, outgoing/incoming demo calls, call clock, mute/unmute/end/decline, owner-scoped reads, real receipts, no real calling claim and readable layout at ${innerWidth}px`;
})();
