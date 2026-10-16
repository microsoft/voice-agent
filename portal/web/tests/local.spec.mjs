// Copyright (c) Microsoft. All rights reserved.
// Browser -> production Foundry-only portal -> test-only Azure service fixture.
import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Exercise normal microphone startup with Playwright's synthetic device.
  await page.addInitScript(() => {
    window.microphoneCalls = 0;
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      window.microphoneCalls += 1;
      return getUserMedia(...args);
    };
  });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" ? route.continue() : route.abort();
  });
});

test("Foundry-only portal creates, edits, connects and reads persisted data through the proxy", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Voice agent studio" })).toBeVisible();
  await expect(page.locator(".portal-notice")).toContainText("Azure Foundry project");
  const config = await (await page.request.get("/config")).json();
  expect(config.host).toBe("https://sample.services.ai.azure.com/api/projects/sample-project");
  expect(config).not.toHaveProperty("mode");
  await expect(page.getByRole("checkbox", { name: /^Save conversations/ })).not.toBeChecked();
  await page.getByRole("textbox", { name: /^Agent name/ }).fill("local-browser-agent");
  await page.getByRole("checkbox", { name: /^Save conversations/ }).check();
  await page.getByRole("button", { name: "Create agent", exact: true }).click();
  await expect(page.getByLabel("Session agent", { exact: true })).toHaveValue("local-browser-agent");
  await page.getByRole("button", { name: "Edit definition" }).click();
  const editor = page.getByLabel("Agent definition YAML");
  await expect(editor).toHaveValue(/Respond naturally and concisely\./);
  const yaml = await editor.inputValue();
  await editor.fill(yaml.replace("Respond naturally and concisely.", "Browser-tested local instructions."));
  await page.getByRole("button", { name: "Save as new version" }).click();
  await expect(page.locator(".definition-save-state")).toContainText("Version 2 created");
  await page.getByRole("button", { name: "Close definition editor" }).click();
  await expect(page.locator(".selected-agent-meta")).toContainText("v2");
  await expect(page.getByRole("button", { name: "View trace" })).toBeDisabled();
  await page.getByRole("button", { name: "Connect & start session" }).click();
  await expect(page.locator(".connection-status")).toContainText("listening");
  await page.getByRole("textbox", { name: "Message your agent" }).fill("Hello from the real local browser");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Fixture response from the simulated Foundry service.", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.microphoneCalls)).toBeGreaterThan(0);
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "View persisted" }).click();
  const popup = await popupPromise;
  await expect(popup.getByRole("heading", { name: "Persisted conversation" })).toBeVisible();
  await expect(popup.getByText("Fixture response from the simulated Foundry service.", { exact: true })).toBeVisible();
  await popup.close();
  await page.screenshot({ path: "../.run/portal-local.png", fullPage: true });
  await page.getByRole("button", { name: "Stop session" }).click();
  await expect(page.getByRole("button", { name: "Connect & start session" })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("guided authoring uses the configured Foundry service response", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await page.getByRole("textbox", { name: /^Generated agent name/ }).fill("local-template-agent");
  await page.getByRole("textbox", { name: /^Goal/ }).fill("Answer questions about this sample.");
  await page.getByRole("button", { name: "Generate agent", exact: true }).click();
  await expect(page.locator(".review-definition")).toContainText("Generated definition from the test fixture.");
});

test("Templates tab detects configured sample variants and returns to the existing studio", async ({ page }) => {
  await page.route("**/api/templates/*/mcp/probe", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: false,
      reached: false,
      error: "Synthetic browser test: local MCP is not running.",
      start_command: "cd VoiceAgent/shared_mcp && ./scripts/e2e-local.sh",
      guide_url: "/guide/run-samples",
    }),
  }));

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Portal pages" })).toBeVisible();
  await page.getByRole("link", { name: "Templates", exact: true }).click();
  await expect(page).toHaveURL(/\/templates$/);
  await expect(page.getByText("4 available", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Example 1: Finance with Handoff — Realtime/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Example 1: Finance with Handoff — Cascade Luna/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Example 2: Finance with OTP and Officer Search/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Example 3: Elevator Service with Safety, Zendesk, and Handoff/ })).toBeVisible();
  await expect(page.locator("#detail-name")).toHaveText("Example 1: Finance with Handoff — Realtime");
  await expect(page.locator("#graph-wrap svg")).toBeVisible();
  await expect(page.locator("#mcp-token-config")).toBeHidden();
  await page.getByRole("link", { name: "Live session", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Voice agent studio" })).toBeVisible();
});

for (const [architecture, model] of [
  ["Realtime", "gpt-realtime-2.1"],
  ["Cascaded", "gpt-5.4"],
]) {
  test(`${architecture} node selectors display the estimate disclaimer and estimated column titles`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/handoff/");
    await page.getByRole("button", { name: /Load from templates/ }).click();
    await page.locator('[data-template-id="elevator-service-example"]').click();
    await page.locator("#node-outline button").first().click();
    await page.locator('[data-node-component="model"]').click();
    await page.locator(`[data-component-kind="model"][data-component-value="${model}"]`).click();

    const panel = page.locator("#node-component-panel-body");
    const disclaimer = panel.getByRole("note", { name: "Latency and cost disclaimer" });
    for (const kind of ["stt", "voice", "model"]) {
      await page.locator(`[data-node-component="${kind}"]`).click();
      await expect(disclaimer).toBeVisible();
      await expect(panel.locator(":scope > :first-child")).toHaveAttribute("role", "note");
      await expect(disclaimer.locator("strong")).toHaveText("Latency & cost disclaimer");
      await expect(disclaimer.locator("p")).toHaveText(
        "Latency and pricing are based on internal experiments and vary with usage scenarios, sales discounts, prompt length, and other factors. These figures are estimates only.",
      );
      await expect(panel.locator(".component-panel-context")).toHaveCount(0);
      await expect(panel.locator(".component-table th").nth(2).locator(".component-sort-label"))
        .toHaveText("Latency (estimated)");
      await expect(panel.locator(".component-table th").nth(3).locator(".component-sort-label"))
        .toHaveText("Cost (estimated)");
      await expect(panel.getByRole("button", { name: "Sort by Cost (estimated)", exact: true }))
        .toBeVisible();
      await panel.getByRole("button", { name: "Sort by Latency (estimated)", exact: true }).click();
      await expect(disclaimer).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}

test("Handoff Graph loads a Portal template, publishes it, and opens the runtime graph", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await page.getByRole("link", { name: "Handoff Graph", exact: true }).click();
  await expect(page).toHaveURL(/\/handoff\/$/);
  await expect(page.getByRole("heading", { name: "Working copy" })).toBeVisible();

  await page.getByRole("button", { name: /Load from templates/ }).click();
  const choices = page.locator(".template-choice");
  await expect(choices).toHaveCount(4);
  await page.locator('[data-template-id="elevator-service-example"]').click();

  await expect(page.locator("#agent-title")).toContainText(
    "local-only-elevator-service-example-",
  );
  await expect(page.locator(".node-card")).toHaveCount(10);
  await page.locator("#node-outline button").first().click();
  await page.locator('[data-node-component="model"]').click();
  await expect(page.locator('[data-component-kind="model"]')).toHaveCount(14);
  await expect(page.locator(".component-table")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sort by Latency (estimated)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sort by Cost (estimated)" })).toBeVisible();
  await page.getByRole("button", { name: "Explain Latency (estimated)" }).click();
  await expect(page.locator('[data-component-header-popup="latency"]')).toBeVisible();
  await expect(page.locator('[data-component-header-popup="latency"]')).toContainText(
    "Estimated minimum model latency",
  );
  await page.getByRole("button", { name: "Explain Cost (estimated)" }).click();
  await expect(page.locator('[data-component-header-popup="cost"]')).toBeVisible();
  await expect(page.locator('[data-component-header-popup="cost"]')).toContainText(
    "Calculated normalized component cost from the row's public rate",
  );
  await expect(
    page.locator('[data-component-kind="model"][data-component-value="gpt-realtime"]')
      .locator("xpath=ancestor::tr"),
  ).toContainText("~0.8 s");
  await expect(
    page.locator('[data-component-kind="model"][data-component-value="gpt-6.1-sol"]')
      .locator("xpath=ancestor::tr"),
  ).toContainText("~1.6 s");
  await expect(
    page.locator('[data-component-kind="model"][data-component-value="gpt-realtime"]')
      .locator("xpath=ancestor::tr"),
  ).toContainText("~1.52 ¢/min");
  await expect(
    page.locator('[data-component-kind="model"][data-component-value="gpt-realtime"]')
      .locator("xpath=ancestor::tr"),
  ).toContainText("Public rate: $32 audio input + $4 text input + $16 text output / 1M tokens");
  await page.getByRole("button", { name: "Sort by Latency (estimated)" }).click();
  await expect(
    page.locator('.component-table tbody [data-component-kind="model"]').first(),
  ).toHaveAttribute("data-component-value", "gpt-realtime-mini");
  await page.getByRole("button", { name: "Sort by Latency (estimated)" }).click();
  await expect(
    page.locator('.component-table tbody [data-component-kind="model"]').first(),
  ).toHaveAttribute("data-component-value", "gpt-6.1-sol");

  await page.locator('[data-component-kind="model"][data-component-value="gpt-6-luna"]').click();
  await expect(page.locator(".model-card .component-metrics")).toContainText(
    "~$0.000154/normalized min",
  );
  await expect(page.locator("#node-cost-value")).toContainText("~$0.019654/normalized min");
  await expect(page.locator(".transcriber-card .component-metrics")).toContainText(
    "~1,016 ms estimated",
  );
  await expect(page.locator(".voice-card .component-metrics")).toContainText(
    "~307 ms estimated",
  );
  await page.locator('[data-node-component="model"]').click();
  await expect(
    page.locator('[data-component-kind="model"][data-component-value="gpt-6-luna"]')
      .locator("xpath=ancestor::tr"),
  ).toContainText("Public rate: $0.11 text input + $0.44 text output / 1M tokens");

  await page.locator('[data-component-kind="model"][data-component-value="gpt-5.4"]').click();
  await page.locator('[data-node-component="stt"]').click();
  await expect(page.locator('[data-component-kind="stt"]')).toHaveCount(12);
  await expect(page.getByRole("button", { name: "Sort by Latency (estimated)" })).toBeVisible();
  await expect(
    page.locator('[data-component-kind="stt"][data-component-value="azure-speech"]')
      .locator("xpath=ancestor::tr"),
  ).toContainText("~1.016 s");
  await expect(
    page.locator('[data-component-kind="stt"][data-component-value="mai-transcribe-2"]'),
  ).toBeEnabled();
  await expect(
    page.locator('[data-component-kind="stt"][data-component-value="mai-transcribe-2"]')
      .locator("xpath=ancestor::tr"),
  ).toContainText("Public rate: $17 / 1M Voice Live speech-input tokens");
  await expect(
    page.locator('[data-component-kind="stt"][data-component-value="azure-speech"]')
      .locator("xpath=ancestor::tr"),
  ).toContainText("Public rate: $17 / 1M Voice Live speech-input tokens");
  await expect(
    page.locator('[data-component-kind="stt"][data-component-value="whisper-1"]'),
  ).toBeDisabled();

  await page.locator('[data-node-component="model"]').click();
  await page.locator('[data-component-kind="model"][data-component-value="gpt-realtime-2.1"]').click();
  await page.locator('[data-node-component="stt"]').click();
  await expect(page.locator('[data-component-kind="stt"]')).toHaveCount(12);
  await expect(
    page.locator('[data-component-kind="stt"][data-component-value="whisper-1"]'),
  ).toBeEnabled();
  await expect(
    page.locator('[data-component-kind="stt"][data-component-value="whisper-1"]')
      .locator("xpath=ancestor::tr"),
  ).toContainText("~1.507 s");
  await expect(
    page.locator('[data-component-kind="stt"][data-component-value="whisper-1"]')
      .locator("xpath=ancestor::tr"),
  ).toContainText("~0.30 ¢/min");
  await expect(
    page.locator('[data-component-kind="stt"][data-component-value="whisper-1"]')
      .locator("xpath=ancestor::tr"),
  ).toContainText("Public rate: $0.006 / audio minute");
  await expect(
    page.locator('[data-component-kind="stt"][data-component-value="native-realtime-audio"]')
      .locator("xpath=ancestor::tr"),
  ).toContainText("No extra STT cost");
  await expect(page.locator(".transcriber-card .component-metrics")).toContainText(
    "STT-only cost ~$0.0051/normalized min",
  );
  await expect(page.locator(".model-card .component-metrics")).toContainText(
    "Model-only cost ~$0.016/normalized min",
  );
  await expect(page.locator(".voice-card .component-metrics")).toContainText(
    "TTS-only cost ~$0.0186/normalized min",
  );
  await expect(page.locator("#node-cost-value")).toContainText("~$0.0397/normalized min");
  await page.locator('[data-node-component="voice"]').click();
  await expect(page.getByRole("button", { name: "Sort by Latency (estimated)" })).toBeVisible();
  await expect(
    page.locator('[data-component-kind="voice"][data-component-value="alloy"]')
      .locator("xpath=ancestor::tr"),
  ).toContainText("Included in model");
  await expect(
    page.locator('[data-component-kind="voice"][data-component-value="en-US-Ava:DragonHDLatestNeural"]')
      .locator("xpath=ancestor::tr"),
  ).toContainText("~0.307 s");
  await expect(
    page.locator('[data-component-kind="voice"][data-component-value="en-US-Ava:DragonHDLatestNeural"]')
      .locator("xpath=ancestor::tr"),
  ).toContainText("Public rate: $31 / 1M Voice Live speech-output tokens");
  await expect(page.locator(".component-provider", { hasText: "GPT native" }).first()).toBeVisible();
  await expect(page.locator(".component-provider", { hasText: "Azure Speech" }).first()).toBeVisible();
  await expect(page.locator(".component-table td:nth-child(4) .component-table-bar").first()).toBeVisible();
  await expect(page.locator("#node-cost-value")).toContainText("normalized min");
  await expect(page.locator("#node-latency-value")).toContainText("~1.3 s – 3.7 s estimated");
  await expect(page.locator(".overview-metric .pipeline-segment.model").last()).toHaveAttribute(
    "title",
    "Range midpoint used for bar · ~2,463 ms estimated",
  );
  await page.locator("#done-node-editor").click();

  await expect(page.locator("#publish-run-action")).toBeEnabled();
  await page.locator("#publish-run-action").click();
  const progress = page.getByRole("dialog", { name: "Publish & run" });
  await expect(progress).toBeVisible();
  await expect(progress).toContainText("Validate working copy");
  await expect(progress).toContainText("Refresh MCP connection");
  await expect(progress).toContainText("Publish Agent version");
  await expect(progress).toContainText("Verify published version");
  await expect(progress).toContainText("Open Live session");
  await expect(progress.locator('[data-publish-step="verify"]')).toHaveAttribute(
    "data-status",
    "complete",
  );

  await expect(page).toHaveURL(/\/demo\/\?agent=local-only-elevator-service-example-[^&]+&view=handoff$/);
  await expect(page.getByRole("heading", { name: "Voice agent studio" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Agent Debug/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.locator(".handoff-graph")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Handoff Graph progress stops on publication failure and preserves the working copy", async ({ page }) => {
  await page.goto("/handoff/");
  await page.getByRole("button", { name: /Load from templates/ }).click();
  await page.locator('[data-template-id="elevator-service-example"]').click();
  await page.route("**/agents/*/versions?*", (route) => route.fulfill({
    status: 502,
    contentType: "application/json",
    body: JSON.stringify({ error: { message: "Synthetic publication failure" } }),
  }));

  await page.locator("#publish-run-action").click();
  const progress = page.getByRole("dialog", { name: "Publish & run" });
  await expect(progress.locator('[data-publish-step="publish"]')).toHaveAttribute(
    "data-status",
    "failed",
  );
  await expect(progress.getByRole("alert")).toContainText("Synthetic publication failure");
  await expect(progress.getByRole("button", { name: "Close", exact: true })).toBeVisible();
  await expect(page.locator("#agent-title")).toContainText("local-only-elevator-service-example-");
  await expect(page).toHaveURL(/\/handoff\/$/);
});

test("WebRTC uses the Foundry project directly and session logs can be disabled", async ({ page }) => {
  await page.goto("/webrtc");
  await expect(page.getByRole("heading", { name: "Start a voice session" })).toBeVisible();
  await page.getByLabel("Agent", { exact: true }).fill("fixture-agent");
  await expect(page.getByRole("button", { name: "Start WebRTC session" })).toBeEnabled();
  expect(await page.evaluate(() => window.microphoneCalls)).toBe(0);
  await page.getByRole("link", { name: "Return to studio" }).click();
  await page.getByRole("link", { name: "Local session logs" }).click();
  await expect(page.getByRole("heading", { name: "Demo session log" })).toBeVisible();
  await expect(page.getByText("session recording is disabled", { exact: true })).toBeVisible();
  const response = await page.request.get("/api/demo/sessions");
  expect(response.ok()).toBe(true);
  expect((await response.json()).sessions).toEqual([]);
});

test("actual HTTP server rejects cross-origin requests and never serves configuration files", async ({ request }) => {
  const crossOrigin = await request.get("/config", { headers: { Origin: "https://example.invalid" } });
  expect(crossOrigin.status()).toBe(403);
  const secrets = await request.get("/static/demo/.env");
  expect(secrets.status()).toBe(404);
});

test("legacy autostart URLs only select an agent; Connect remains an explicit action", async ({ page }) => {
  const sockets = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  await page.goto("/?agent=fixture-agent&autostart=1");
  await expect(page.getByLabel("Session agent", { exact: true })).toHaveValue("fixture-agent");
  await page.waitForLoadState("networkidle");
  expect(sockets).toEqual([]);
  expect(await page.evaluate(() => window.microphoneCalls)).toBe(0);
  await expect(page.getByRole("button", { name: "Connect & start session" })).toBeEnabled();
});
