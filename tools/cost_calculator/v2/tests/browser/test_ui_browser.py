"""Page test without Azure: run the server with --preview, then

    python tests/browser/test_ui_browser.py --url http://127.0.0.1:8781

Checks that the price per minute comes first, that the cost tree opens level by level with every cost in
cents per minute, that the detail area follows the clicked node and the concept buttons, and drives the
page through the same path the Agent's function calls take (costDemo.simulateAgentCall).
Screenshots go to artifacts/.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

ARTIFACTS = Path(__file__).resolve().parents[2] / "artifacts"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8781")
    parser.add_argument("--reduced-motion", action="store_true")
    args = parser.parse_args()
    ARTIFACTS.mkdir(exist_ok=True)
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000},
                                reduced_motion="reduce" if args.reduced_motion else "no-preference")
        page.on("console", lambda m: errors.append(f"console {m.type}: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.goto(args.url)
        page.wait_for_selector('.tree-row[data-node="price"]')
        row = lambda node: page.locator(f'.tree-row[data-node="{node}"]')

        call = lambda name, a=None: page.evaluate("([n, a]) => costDemo.simulateAgentCall(n, a)", [name, a or {}])
        state = lambda: page.evaluate("costDemo.state()")
        price = lambda: page.locator("#price-now").inner_text()

        assert page.locator(".scheme-card").count() == 4  # three standard options and Custom
        assert "6.15" in page.locator("#preview-price").inner_text()
        assert price() == "6.15 ¢/min"
        # One algorithm and no play buttons: a big COST readout, the tree and the bill are live from the start.
        assert page.locator(".cost-word").inner_text() == "COST"
        for gone in ["#calculate", "#play", "#prev-step", "#next-step", "[data-formula]", "#cache", "#knob-formula"]:
            assert page.locator(gone).count() == 0, gone
        assert page.locator("#tiles .tile").count() == 4
        assert page.locator("#savings").is_hidden() and page.locator("#savings-toggle").is_visible()
        page.screenshot(path=str(ARTIFACTS / "01_setup.png"))

        # The root is open: STT (none on realtime), TTS, model input, model output, in cents per minute.
        assert page.locator(".tree-row").count() == 5
        lines = page.locator('.tree-row[data-kind="cost"] .tree-value').all_inner_texts()
        assert lines[1:] == ["0.561 ¢/min", "1.30 ¢/min", "3.35 ¢/min", "0.936 ¢/min"], lines

        # Click down the model input to the earlier audio that misses the cache.
        row("price.model_input").click()
        assert page.locator("#detail-value").inner_text() == "3.35 ¢/min"
        assert page.locator("#detail-children li").count() == 2
        row("price.model_input.uncached").click()
        assert page.locator("#detail-value").inner_text() == "1.94 ¢/min"
        row("price.model_input.uncached.audio").click()
        assert page.locator("#detail-value").inner_text() == "1.57 ¢/min"
        assert page.locator("#detail-children li").count() == 2
        row("price.model_input.uncached.audio.rounding").click()
        assert page.locator("#detail-value").inner_text() == "0.516 ¢/min"
        assert "161 tokens/min × $32 / 1M tokens" in page.locator("#formula-numbers").inner_text()
        # A product is a leaf: its numbers sit on the row, its factors are equations in the detail area.
        leaf = "price.model_input.uncached.audio.rounding"
        assert page.locator(f'.tree-row[data-node^="{leaf}."]').count() == 0
        # The row shows tokens per minute and the rate in their own columns, under a head with three column names.
        assert row(leaf).locator(".tree-num").all_inner_texts() == ["161", "$32"], row(leaf).locator(".tree-num").all_inner_texts()
        assert page.locator(".tree-head .tree-num").count() == 3
        factors = page.locator("#detail-children .factor-label").all_inner_texts()
        assert factors[0] == "Uncached tokens" and "Audio input rate" in factors, factors
        assert page.locator("#detail-children button").count() == 0
        page.wait_for_timeout(2600)
        # The diagram draws the walk: one row per response (45 in 15 minutes), a cached and a full-price bar each.
        bars = page.locator("#stage rect").count()
        assert bars >= 90, bars
        page.locator(".calc").screenshot(path=str(ARTIFACTS / "02_tree_model_input.png"))
        audio = "price.model_input.uncached.audio"
        row(audio).click()
        row(audio).click()  # selected and open: collapses
        assert page.locator(f'.tree-row[data-node^="{audio}."]').count() == 0

        for concept, title in [("request", "What each response sends"), ("cache", "How the cache prices it"),
                               ("handoff", "What a handoff does"), ("compaction", "What a compaction does")]:
            page.click(f'.concept-chip[data-concept="{concept}"]')
            assert page.locator("#formula-title").inner_text() == title
            page.wait_for_timeout(3200)
            page.locator("#detail").screenshot(path=str(ARTIFACTS / f"03_concept_{concept}.png"))

        page.click("#expand-all")
        values = page.locator('.tree-row[data-kind="cost"] .tree-value').all_inner_texts()
        # 21 cost nodes on GPT Realtime 2.1. Tokens per minute, shares and rates are factors, never tree rows.
        assert page.locator('.tree-row:not([data-kind="cost"])').count() == 0
        assert len(values) == 21 and all(text.endswith("¢/min") for text in values), values
        page.locator(".calc").screenshot(path=str(ARTIFACTS / "04_tree_expanded.png"))

        # The cache knob shows the share the walk works out; compaction sits beside the prompt design.
        assert page.locator("#cache-measured").inner_text() == "96%"
        page.click('[data-prompt="stage"]')
        page.click("#knob-compaction")
        assert state()["params"]["summarise"] is True, state()
        assert price() == "5.93 ¢/min"
        assert page.locator("#summary-text").inner_text() == "at each handoff"
        page.locator(".setup").screenshot(path=str(ARTIFACTS / "07_handoff_compaction.png"))
        page.click("#knob-compaction")
        page.click('[data-prompt="single"]')
        assert price() == "6.15 ¢/min"

        # Custom card: two hostings, split by who bills the model; the chosen one carries a check, ? explains both.
        page.select_option("#custom-model", "gpt-4.1")
        hosting = page.locator("#custom-hosting button")
        assert hosting.all_inner_texts() == ["Managed", "BYOM"], hosting.all_inner_texts()
        border = hosting.first.evaluate("b => getComputedStyle(b).borderTopWidth + ' ' + getComputedStyle(b).borderTopStyle")
        assert border == "1px solid", border
        page.click('#custom-hosting button:has-text("BYOM")')
        assert state()["option"] == "gpt-4.1@byom", state()
        pressed = page.locator('#custom-hosting button[aria-pressed="true"]')
        assert pressed.inner_text() == "BYOM"
        assert pressed.evaluate("b => getComputedStyle(b, '::before').content") == '"✓"'
        assert "not priced here" in page.locator("#hosting-note").inner_text()
        # BYOM shows the voice-agent cost only, with the model named as the extra.
        assert page.locator("#custom-card .scheme-price").inner_text() == "1.38 ¢/min + model"
        assert page.locator("#preview-price").inner_text().endswith(" + model")
        page.hover("#custom-card .help-dot")
        tip = page.locator("#tooltip").inner_text()
        assert all(word in tip for word in ["Managed:", "BYOM (bring your own model)", "pay-as-you-go or PTU", "not priced here"]), tip
        assert "PTU (provisioned throughput)" not in tip
        page.locator("#custom-card").screenshot(path=str(ARTIFACTS / "08_custom_byom.png"))
        page.screenshot(path=str(ARTIFACTS / "09_byom_page.png"))
        page.click('.scheme-card[data-scheme="gpt-realtime-2.1@managed"]')
        page.focus("#talk-handle-a")
        for _ in range(5):
            page.keyboard.press("ArrowRight")
        assert [state()["params"]["callerTalkPercent"], state()["params"]["agentTalkPercent"]] == [60, 30], state()
        page.focus("#talk-handle-a")
        for _ in range(5):
            page.keyboard.press("ArrowLeft")
        # The ways to pay less open from the right edge, for the settings above.
        page.click("#savings-toggle")
        assert page.locator("#savings").is_visible()
        assert "GPT Realtime 2.1" in page.locator("#savings-context").inner_text()
        chip = lambda tip: page.locator(f'.saving-card[data-tip="{tip}"] .verdict-chip').inner_text()
        assert page.locator('.saving-card[data-tip="handoff"]').count() == 0  # splitting a 4k prompt alone costs more
        assert chip("compaction") == "✕ Measured: costs more here"
        assert chip("handoff_compaction") == "◐ Measured: only in some cases"
        page.fill("#logic-tokens", "14000")
        page.dispatch_event("#logic-tokens", "change")
        assert chip("handoff_compaction") == "✓ Measured: saves here"
        assert "16,000 prompt tokens" in page.locator("#savings-context").inner_text()
        page.screenshot(path=str(ARTIFACTS / "06_savings.png"))
        page.fill("#logic-tokens", "4000")
        page.dispatch_event("#logic-tokens", "change")
        assert price() == "6.15 ¢/min"
        page.keyboard.press("Escape")
        assert page.locator("#savings").is_hidden()

        byom_price = "1.38 cents a minute, plus the model on your deployment"
        assert not call("set_parameters", {"model": "gpt-6-luna", "hosting": "ptu"})["ok"]
        changed = call("set_parameters", {"model": "gpt-6-luna", "hosting": "byom", "minutes": 15})
        assert changed["ok"] and changed["price"]["per_minute"] == byom_price, changed
        assert not call("set_parameters", {"minutes": 0})["ok"]
        walk = call("start_walkthrough")
        assert walk["price_per_minute"] == byom_price and walk["script"][0].startswith("The price is 1.38"), walk
        assert "the model is extra" in walk["script"][0], walk
        # The guide says the script; the page opens each part as its number is spoken, then the bill.
        narrated = page.evaluate("text => costDemo.simulateNarration(text)", " ".join(walk["script"]))
        assert narrated["shown"] == narrated["expected"] and len(narrated["shown"]) == 3, narrated  # price, TTS, STT
        assert page.locator("#tiles .tile").count() == 4
        for node_id in ["price", "price.stt", "price.tts"]:
            shown = call("show_cost_node", {"node_id": node_id})
            assert shown["ok"], shown
        assert not call("show_cost_node", {"node_id": "price.model_input"})["ok"]  # the model is not priced on BYOM
        assert call("show_cost_node", {"node_id": "price.stt.stt_rate"})["ok"]
        # A factor is not a tree row: asking for it opens the product it belongs to, with the factor as an equation.
        assert page.evaluate("costDemo.view()")["selected"] == "price.stt"
        assert "STT rate" in page.locator("#detail-children .factor-label").all_inner_texts()
        assert page.locator("#price-now").inner_text() == "1.38 ¢/min"
        assert call("show_concept", {"concept": "handoff"})["ok"]
        page.wait_for_timeout(600)
        assert page.locator("#formula-title").inner_text() == "What a handoff does"
        result = call("show_result")
        assert result["ok"] and result["per_minute"] == byom_price, result
        ranking = call("compare_options")
        assert ranking["ok"] and 4 <= len(ranking["cheapest_first"]) <= 7, ranking
        savings = call("show_savings")
        assert savings["ok"] and savings["tips"] == [], savings  # on BYOM nothing on the page moves the voice-agent cost
        assert call("set_parameters", {"hosting": "managed"})["ok"]
        savings = call("show_savings")
        assert savings["ok"] and savings["tips"], savings
        page.wait_for_timeout(1500)
        assert page.locator("#savings").is_visible()
        page.keyboard.press("Escape")
        page.screenshot(path=str(ARTIFACTS / "05_full_page.png"), full_page=True)
        # The address bar always holds the settings, so it can be shared as it is.
        assert "option=" in page.url, page.url

        # A link opens the same settings; every change rewrites it; the button copies it; Export Excel downloads the
        # same numbers. A link with settings the page cannot use opens the rest and names what it ignored.
        context = browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True,
                                      permissions=["clipboard-read", "clipboard-write"])
        shared = context.new_page()
        shared.on("pageerror", lambda e: errors.append(f"pageerror (shared): {e}"))
        shared.goto(f"{args.url}/?option=gpt-realtime-2.1%40managed&minutes=30&promptDesign=stage&stages=6")
        shared.wait_for_selector('.tree-row[data-node="price"]')
        assert shared.locator("#price-now").inner_text() == "8.21 ¢/min", shared.locator("#price-now").inner_text()
        assert shared.locator("#input-error").is_hidden()
        assert shared.evaluate("costDemo.simulateAgentCall('set_parameters', {minutes: 20})")["ok"]
        shared.wait_for_timeout(300)
        assert "minutes=20" in shared.url and "stages=6" in shared.url, shared.url
        assert shared.locator("#price-now").inner_text() == "7.76 ¢/min"
        shared.click("#copy-link")
        shared.wait_for_timeout(200)
        assert shared.evaluate("navigator.clipboard.readText()") == shared.url, shared.evaluate("navigator.clipboard.readText()")
        assert shared.locator("#copy-link").inner_text() == "Link copied ✓"
        with shared.expect_download() as download:
            shared.click("#export-excel")
        saved = ARTIFACTS / download.value.suggested_filename
        download.value.save_as(saved)
        assert saved.name == "voice-agent-cost_gpt-realtime-2.1-managed_20min.xlsx", saved.name
        import re
        import zipfile
        with zipfile.ZipFile(saved) as book:
            assert book.testzip() is None
            cost = book.read("xl/worksheets/sheet1.xml").decode()
            assert '<sheet name="Nodes"' in book.read("xl/workbook.xml").decode()
        root = float(re.search(r'<c r="D8"[^>]*><f>[^<]*</f><v>([^<]+)</v>', cost).group(1))
        assert f"{root:.2f} ¢/min" == "7.76 ¢/min", root
        shared.goto(f"{args.url}/?minutes=abc&foo=1&stages=4")
        shared.wait_for_selector('.tree-row[data-node="price"]')
        note = shared.locator("#input-error").inner_text()
        assert shared.locator("#input-error").is_visible() and "foo" in note and "minutes" in note, note
        assert shared.evaluate("costDemo.state()")["params"]["stages"] == 4
        shared.screenshot(path=str(ARTIFACTS / "06_shared_link.png"))
        context.close()
        browser.close()
    assert not errors, "\n".join(errors)
    print(json.dumps({"ok": True, "screenshots": str(ARTIFACTS), "cheapest": ranking["cheapest_first"][0]}))


if __name__ == "__main__":
    main()
