import test from "node:test";
import assert from "node:assert/strict";
import { LocalPhone } from "./phone-demo.mjs";

const ready = () => {
  const phone = new LocalPhone();
  phone.configure(["Alex Chen", "Maya Singh", "Jordan Lee"]);
  phone.setConnected(true);
  return phone;
};
test("local call demo dials, connects, times, mutes, and ends without real phone capabilities", () => {
  const phone = ready();
  const dialing = phone.command({ action: "dial", contact: "Alex Chen" });
  assert.equal(dialing.call_state, "dialing");
  assert.equal(dialing.connected, false);
  assert.equal(dialing.calling_available, false);
  assert.equal(phone.advance(1.49).call_state, "dialing");
  assert.equal(phone.advance(.01).call_state, "active");
  assert.equal(phone.advance(3).duration_seconds, 3);
  assert.equal(phone.command({ action: "mute" }).muted, true);
  assert.equal(phone.command({ action: "unmute" }).muted, false);
  const ended = phone.command({ action: "end" });
  assert.equal(ended.call_state, "ended");
  assert.equal(ended.reason, "Call ended");
  assert.equal(phone.advance(30).duration_seconds, 3);
});
test("incoming demo calls require answer or decline and do not auto-answer", () => {
  const phone = ready();
  assert.equal(phone.incoming("Maya Singh").call_state, "incoming");
  assert.equal(phone.advance(30).call_state, "incoming");
  assert.equal(phone.command({ action: "answer" }).direction, "incoming");
  assert.equal(phone.command({ action: "end" }).call_state, "ended");
  phone.incoming("Jordan Lee");
  assert.equal(phone.command({ action: "reject" }).reason, "Call declined");
});
test("invalid, stale, and disconnected call commands cannot change state", () => {
  const phone = ready();
  for (const args of [{ action: "dial" }, { action: "dial", contact: "Unknown" },
    { action: "dial", contact: "Alex Chen", number: "123" }, { action: "answer" },
    { action: "reject" }, { action: "end" }, { action: "mute" },
    { action: "unmute", contact: "Alex Chen" }, { action: "pair" }]) {
    const before = phone.snapshot();
    assert.throws(() => phone.command(args));
    assert.deepEqual(phone.snapshot(), before);
  }
  assert.throws(() => phone.command({ action: "dial", contact: "Alex Chen" }, -1), /changed/);
  phone.command({ action: "dial", contact: "Alex Chen" });
  assert.throws(() => phone.incoming("Maya Singh"), /End the current/);
  const ended = phone.setConnected(false);
  assert.equal(ended.reason, "Controls disconnected");
  assert.equal(ended.available, false);
  assert.throws(() => phone.command({ action: "dial", contact: "Alex Chen" }), /disconnected/);
  phone.setConnected(true);
  assert.equal(phone.snapshot().call_state, "ended");
  assert.throws(() => phone.advance(NaN));
  assert.throws(() => phone.advance(-1));
});
test("call clocks are frame-independent and snapshots do not expose mutable contacts", () => {
  const a = ready(), b = ready();
  for (const phone of [a, b]) phone.command({ action: "dial", contact: "Alex Chen" });
  a.advance(6.5);
  for (let i = 0; i < 65; i++) b.advance(.1);
  assert.equal(a.snapshot().call_state, b.snapshot().call_state);
  assert.ok(Math.abs(a.elapsed - b.elapsed) < 1e-10);
  const state = a.snapshot();
  state.contacts.pop();
  assert.equal(a.contacts.length, 3);
});

test("phone errors use operational wording without demo or simulation qualifiers", () => {
  const phone = ready();
  for (const args of [
    { action: "dial", contact: "Unknown" }, { action: "answer" },
    { action: "reject" }, { action: "end" }, { action: "mute" },
  ]) {
    assert.throws(() => phone.command(args), (error) => {
      assert.doesNotMatch(error.message, /demo|simulat|mock/i);
      return true;
    });
  }
  phone.command({ action: "dial", contact: "Alex Chen" });
  assert.throws(() => phone.incoming("Maya Singh"), /^Error: End the current call first\.$/);
});
