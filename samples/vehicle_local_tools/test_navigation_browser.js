// Run only against an isolated local cockpit: this test changes destination state.
(async () => {
  const { command } = await import("/static/cockpit.js");
  const { processEvent } = await import("/static/app.js");
  const $ = (id) => document.getElementById(id);
  const panel = document.querySelector(".navigation-card");
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const waitFor = async (predicate) => {
    for (let i = 0; i < 150; i++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Navigation browser condition timed out.");
  };
  const execute = async (name, args) => {
    const packet = await command(name, args);
    assert(packet.result.ok, JSON.stringify(packet.result));
    document.dispatchEvent(new CustomEvent("cockpit-snapshot", { detail: packet.state }));
    return packet;
  };
  const submit = (destination) => {
    $("destination-input").value = destination;
    $("nav-form").dispatchEvent(new Event("submit", { cancelable: true }));
  };
  const fit = () => {
    if (innerWidth > 1100 && innerHeight >= 720) {
      assert(panel.scrollHeight <= panel.clientHeight + 2, "Navigation card fits without clipping");
      assert(document.documentElement.scrollHeight <= innerHeight + 2, "Desktop still fits one screen");
    }
    assert(document.documentElement.scrollWidth <= innerWidth, "No horizontal overflow");
    const input = $("destination-input").getBoundingClientRect();
    const button = $("nav-form").querySelector("button").getBoundingClientRect();
    assert(input.right <= button.left && button.right <= panel.getBoundingClientRect().right, "Destination input and Update fit");
    const warning = $("sim-warning").getBoundingClientRect();
    assert(warning.bottom <= panel.getBoundingClientRect().bottom + 1, "Autopilot warnings stay visible independently of itinerary scrolling");
  };
  await waitFor(() => $("control-status").textContent === "Controls connected");
  assert(document.querySelector(".navigation-card .autopilot-controls #sim-engage"), "Autopilot is inside the navigation sidebar");
  await execute("clear_destination", {});
  await waitFor(() => $("nav-status").textContent === "NOT SET");
  assert($("nav-clear").disabled && panel.dataset.destinationSet === "false", "Empty state is explicit");
  assert(panel.querySelector(".map svg") === null, "No invented route or geographic pin");
  const emptyBorder = getComputedStyle(panel).borderColor;
  fit();
  submit("Shanghai Hongqiao International Airport");
  assert($("nav-status").textContent === "SAVING" && $("destination-input").disabled, "Manual action visibly waits for confirmation");
  await waitFor(() => $("nav-status").textContent === "SAVED");
  assert($("destination").textContent === "Shanghai Hongqiao International Airport" && $("destination-input").value === "", "Saved destination remains prominent while editor resets");
  assert($("nav-form").querySelector("button").textContent === "Add" && !$("nav-clear").disabled, "Editor stays ready to append the next stop");
  assert(getComputedStyle(panel).borderColor !== emptyBorder && parseFloat(getComputedStyle($("destination")).fontSize) >= 16, "Merged navigation keeps a persistent border and readable destination");
  assert($("nav-confirmation").textContent.includes("no route or ETA"), "No false navigation claim");
  fit();
  submit("Rejected\u0001destination");
  await waitFor(() => $("nav-status").textContent === "FAILED");
  assert($("destination").textContent === "Shanghai Hongqiao International Airport" && !$("error").hidden, "Rejected update keeps authoritative destination and surfaces error");
  assert(!$("destination-input").disabled && $("nav-confirmation").textContent.includes("not confirmed"), "Failed operation is retryable");
  submit("Riverside Park");
  await waitFor(() => $("nav-status").textContent === "SAVED");
  assert($("destination").textContent === "Shanghai Hongqiao International Airport", "Appending preserves the first destination");
  assert([...$("nav-stops").querySelectorAll(".stop-name")].map((node) => node.textContent).join("|") === "Shanghai Hongqiao International Airport|Riverside Park", "Stops retain requested order after retry");
  $("nav-stops").querySelector('[aria-label="Edit stop 2"]').click();
  assert($("destination-input").value === "Riverside Park" && !$("nav-cancel-edit").hidden, "Each stop is editable in the shared editor");
  submit("Riverside <b>Garden</b>");
  await waitFor(() => $("nav-status").textContent === "SAVED");
  assert($("nav-stops").querySelectorAll(".stop-name")[1].textContent === "Riverside <b>Garden</b>" && !$("nav-stops").querySelector("b"), "Editing preserves order and renders destination text safely");
  assert($("destination-input").value === "" && $("nav-cancel-edit").hidden, "Successful edit restores continuous add mode");
  $("nav-stops").querySelector('[aria-label="Edit stop 1"]').click();
  $("destination-input").value = "Discard this edit";
  $("nav-cancel-edit").click();
  assert($("destination-input").value === "" && $("destination").textContent === "Shanghai Hongqiao International Airport", "Cancel leaves saved state untouched");
  $("nav-stops").querySelector('[aria-label="Remove stop 1"]').click();
  await waitFor(() => $("nav-status").textContent === "SAVED");
  assert($("destination").textContent === "Riverside <b>Garden</b>" && $("nav-stops").children.length === 1, "Removing the first stop advances the next destination");
  $("nav-stops").querySelector('[aria-label="Edit stop 1"]').click();
  await execute("set_destination", { destination: "Updated from another control" });
  assert($("nav-cancel-edit").hidden && !$("error").hidden, "Concurrent itinerary changes invalidate the editor explicitly");
  document.querySelector(".nav-options").open = true;
  $("nav-avoid_tolls").checked = true;
  $("nav-avoid_tolls").dispatchEvent(new Event("change"));
  assert($("nav-status").textContent === "UPDATING", "Preference update has visible pending state");
  await waitFor(() => $("nav-status").textContent === "SAVED");
  assert($("nav-preferences-label").textContent === "Preferences · 1 selected", "Collapsed preferences expose applied option count");
  document.querySelector(".nav-options").open = false;
  panel.scrollTop = 0;
  fit();
  processEvent({ turn: 901, stage: "executing", name: "set_destination", arguments: '{"destination":"Voice Plaza"}', detail: "Updating destination" });
  assert($("nav-status").textContent === "SAVING", "Voice tool execution updates the same panel");
  const voice = await execute("set_destination", { destination: "Voice Plaza" });
  assert($("nav-status").textContent === "SAVING", "Pending voice result does not prematurely claim completion");
  processEvent({ turn: 901, stage: "result", name: "set_destination", result: voice.result, detail: "Destination saved" });
  assert($("nav-status").textContent === "SAVED" && $("destination").textContent === "Voice Plaza", "Voice completion uses authoritative saved state");
  processEvent({ turn: 901, stage: "complete", detail: "Ready" });
  processEvent({ turn: 902, stage: "executing", name: "clear_destination", arguments: "{}", detail: "Clearing destination" });
  assert($("nav-status").textContent === "CLEARING", "Voice clear is visible");
  processEvent({ turn: 902, stage: "interrupted", detail: "Interrupted" });
  assert($("nav-status").textContent === "FAILED" && !$("destination-input").disabled, "Interrupted voice action cannot leave navigation stuck or falsely confirmed");
  document.querySelector(".nav-options").open = true;
  $("nav-clear").click();
  assert($("nav-status").textContent === "CLEARING", "Manual clear is visible");
  await waitFor(() => $("nav-status").textContent === "NOT SET");
  assert($("destination").textContent === "No destination selected" && $("nav-clear").disabled, "Clear restores truthful empty state");
  document.querySelector(".nav-options").open = false;
  panel.scrollTop = 0;
  const longDestination = "A".repeat(200);
  submit(longDestination);
  await waitFor(() => $("nav-status").textContent === "SAVED");
  assert($("destination").textContent === longDestination, "Long valid destinations are not truncated in state");
  assert(document.documentElement.scrollWidth <= innerWidth, "Long destinations wrap without horizontal overflow");
  await execute("clear_destination", {});
  for (let i = 0; i < 8; i++) {
    submit(`Stop ${i + 1}`);
    await waitFor(() => $("nav-status").textContent === "SAVED" && $("nav-stops").children.length === i + 1);
  }
  assert($("nav-form").querySelector("button").disabled, "Eight-stop limit is explicit in the add control");
  $("nav-stops").querySelector('[aria-label="Edit stop 8"]').click();
  assert(!$("nav-form").querySelector("button").disabled, "A full itinerary can still be edited");
  submit("Updated final stop");
  await waitFor(() => $("nav-status").textContent === "SAVED" && $("nav-stops").lastElementChild.textContent.includes("Updated final stop"));
  await execute("clear_destination", {});
  panel.scrollTop = 0;
  fit();
  assert(!/\bdemo\b|simulat|模拟|仿真/i.test(document.body.innerText), "Visible cockpit uses operational wording");
  return `PASS: ordered itinerary add/edit/remove/cancel/concurrent changes, navigation pending/failed/clear/retry, voice events and interruption, real receipts, preferences, safe text, 200-character input and layout at ${innerWidth}px`;
})();
