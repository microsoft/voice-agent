"""Live test against a real Voice Agent (uses Azure quota). Start the server with voice, then

    python tests/browser/test_live_browser.py --url http://127.0.0.1:8780

Types four requests to the cost guide and checks what it did on the page and what it said:
1. a walkthrough of the cost tree: start_walkthrough, every node in the returned order with show_cost_node,
   the request concept, then show_result; 2. a what-if change of call length; 3. a question about handoffs;
4. a comparison of all options.
The transcript and function calls are written to artifacts/live_run.json.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ARTIFACTS = Path(__file__).resolve().parents[2] / "artifacts"


def wait_idle(page, timeout=120):
    """Wait until the guide has finished replying and speaking."""
    deadline = time.time() + timeout
    quiet_since = None
    while time.time() < deadline:
        state = page.locator("#agent-state").get_attribute("data-state")
        if state == "listening":
            quiet_since = quiet_since or time.time()
            if time.time() - quiet_since > 2.5:
                return
        else:
            quiet_since = None
        page.wait_for_timeout(250)
    diagnostics = {
        "agent_state": page.locator("#agent-state").get_attribute("data-state"),
        "voice_status": page.locator("#voice-status").inner_text(),
        "error": page.locator("#error").inner_text() if page.locator("#error").is_visible() else None,
        "calls": page.evaluate("costDemo.calls()"),
        "transcript": page.locator("#transcript").inner_text(),
    }
    (ARTIFACTS / "live_timeout.json").write_text(json.dumps(diagnostics, indent=2), encoding="utf-8")
    raise TimeoutError(f"The guide did not finish within the timeout: {json.dumps(diagnostics)[:3000]}")


def say(page, text):
    page.fill("#message", text)
    page.click("#send")
    page.wait_for_timeout(1500)
    wait_idle(page, 240)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8780")
    args = parser.parse_args()
    ARTIFACTS.mkdir(exist_ok=True)
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.goto(args.url)
        page.wait_for_function("window.costDemo !== undefined")
        page.evaluate("document.getElementById('use-mic').checked = false")
        page.click("#guide-launcher")
        deadline = time.time() + 60
        while page.locator("#agent-live").inner_text() != "LIVE":
            error = page.locator("#error")
            assert time.time() < deadline and not error.is_visible(), f"Not live: {error.inner_text()}"
            page.wait_for_timeout(250)
        wait_idle(page)
        page.click("#type-toggle")

        say(page, "Walk me through what a 15-minute call on GPT Realtime 2.1 costs.")
        calls = page.evaluate("costDemo.calls()")
        names = [c["name"] for c in calls]
        start = next((c for c in calls if c["name"] == "start_walkthrough"), None)
        narrated = page.evaluate("costDemo.narrated()")
        price_1 = page.locator("#price-now").inner_text().split()[0]
        # The bill is always on the page; when the narration ends the page scrolls to it.
        bill_1 = page.locator("#result").evaluate("e => { const r = e.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }")
        transcript_1 = page.locator("#transcript").inner_text()
        page.screenshot(path=str(ARTIFACTS / "live_1_walkthrough.png"), full_page=True)

        say(page, "What if the call lasts 30 minutes instead?")
        calls_2 = page.evaluate("costDemo.calls()")[len(calls):]
        state_2 = page.evaluate("costDemo.state()")
        price_2 = page.locator("#price-now").inner_text().split()[0]
        transcript_2 = page.locator("#transcript").inner_text()

        say(page, "What happens to the cost at a handoff?")
        calls_3 = page.evaluate("costDemo.calls()")[len(calls) + len(calls_2):]
        page.locator("#detail").screenshot(path=str(ARTIFACTS / "live_3_handoff.png"))

        say(page, "Which option is the cheapest for that call?")
        calls_4 = page.evaluate("costDemo.calls()")[len(calls) + len(calls_2) + len(calls_3):]

        say(page, "How could I make this call cheaper?")
        calls_5 = page.evaluate("costDemo.calls()")[len(calls) + len(calls_2) + len(calls_3) + len(calls_4):]
        transcript = page.locator("#transcript").inner_text()
        last_reply = transcript.split("How could I make this call cheaper?")[-1]
        page.locator("#savings").screenshot(path=str(ARTIFACTS / "live_5_savings.png"))
        page.click("#close-guide")
        browser.close()

    strip = lambda items: [{k: v for k, v in c.items() if k != "result"} for c in items]
    report = {"walkthrough_calls": strip(calls), "what_if_calls": strip(calls_2), "handoff_calls": strip(calls_3),
              "compare_calls": strip(calls_4), "savings_calls": strip(calls_5), "narration": narrated,
              "transcript": transcript, "errors": errors}
    (ARTIFACTS / "live_run.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    savings = next((c.get("result") or {} for c in calls_5 if c["name"] == "show_savings"), {})
    costs_more = [tip["title"] for tip in savings.get("tips", []) if tip.get("measured") == "measured to cost more under these inputs"]
    checks = {
        "walkthrough started": bool(start),
        "no function call during the narration": names[-1] == "start_walkthrough" if names else False,
        "narration opened every part in order": narrated["shown"] == narrated["expected"],
        "request concept shown during narration": "concept:request" in narrated["shown"],
        "bill in view after the narration": bill_1,
        "every call ok": all(c["ok"] for c in calls + calls_2 + calls_3 + calls_4 + calls_5),
        "said the price on the page": price_1 in transcript_1,
        "what-if set 30 minutes": state_2["params"]["minutes"] == 30 and any(c["name"] == "set_parameters" for c in calls_2),
        "said the new price on the page": price_2 != price_1 and price_2 in transcript_2.split("What if the call lasts 30 minutes instead?")[-1],
        "handoff concept shown": any(c["name"] == "show_concept" and c["args"].get("concept") == "handoff" for c in calls_3),
        "compared options": any(c["name"] == "compare_options" for c in calls_4),
        "savings shown": any(c["name"] == "show_savings" for c in calls_5),
        "did not recommend a tip measured to cost more": all(title.lower() not in last_reply.lower() or "cost" in last_reply.lower() for title in costs_more),
        "no page errors": not errors,
    }
    print(json.dumps(checks, indent=1))
    failed = [name for name, ok in checks.items() if not ok]
    assert not failed, f"Failed: {failed}. See {ARTIFACTS / 'live_run.json'}"


if __name__ == "__main__":
    main()
