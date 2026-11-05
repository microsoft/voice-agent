export class AutopilotSimulator {
  constructor(limits = { speed: [0, 120], gap: [1, 7] }) {
    this.limits = limits;
    this.visible = true;
    this.connected = false;
    this.bodyReady = true;
    this.remainder = 0;
    this.elapsed = 0;
    this.reference = null;
    this.state = {
      available: true, running: true, mode: "disengaged",
      target_speed_kmh: 60, actual_speed_kmh: 0, following_gap: 3,
      lane_keeping: true, lane_visible: true, lane_offset: 0,
      lead_distance_m: 70, reason: null, rev: 0, distance_m: 0, scenario: "clear",
    };
  }
  snapshot() { return { ...this.state }; }
  setConditions({ visible = this.visible, connected = this.connected, bodyReady = this.bodyReady }) {
    this.visible = visible;
    this.connected = connected;
    this.bodyReady = bodyReady;
    if (!visible || !connected || !bodyReady) {
      this.halt(!visible ? "Page hidden" : !connected ? "Control connection lost" : "Body opening interlock");
    } else if (["Page hidden", "Control connection lost", "Body opening interlock"].includes(this.state.reason)) {
      this.state.reason = null;
      this.state.rev++;
    }
  }
  halt(reason, takeover = false) {
    const s = this.state;
    const mode = takeover ? "takeover_required" : ["takeover_required", "fault"].includes(s.mode) ? s.mode : "disengaged";
    if (s.mode !== mode || s.reason !== reason) {
      Object.assign(s, { mode, actual_speed_kmh: this.reference?.speedKmh ?? 0, reason, rev: s.rev + 1 });
    }
    this.remainder = 0;
  }
  command(args, revision = this.state.rev) {
    const s = this.state;
    if (revision !== s.rev) throw new Error("Driving state changed. Review and retry.");
    const allowed = ["action", "target_speed_kmh", "following_gap", "lane_keeping"];
    if (Object.keys(args).some((key) => !allowed.includes(key))) throw new Error("Unknown assistance field.");
    const actions = ["engage", "disengage", "update"];
    if (!actions.includes(args.action)) throw new Error("Unknown assistance action.");
    const patch = Object.keys(args).filter((key) => key !== "action");
    if (args.action === "update" && !patch.length) throw new Error("Choose an assistance setting.");
    if (args.action === "disengage" && patch.length) throw new Error("Action cannot change settings.");
    for (const [key, [min, max]] of Object.entries({
      target_speed_kmh: this.limits.speed, following_gap: this.limits.gap,
    })) {
      if (key in args && (typeof args[key] !== "number" || !Number.isFinite(args[key])
        || args[key] < min || args[key] > max || (key === "following_gap" && !Number.isInteger(args[key])))) {
        throw new Error(`${key} must be ${min} to ${max}.`);
      }
    }
    if ("lane_keeping" in args && typeof args.lane_keeping !== "boolean") throw new Error("Invalid lane keeping setting.");
    if (args.action === "engage") {
      if (!this.visible || !this.connected || !this.bodyReady) throw new Error("Controls must be visible, connected, with doors and compartments closed.");
      if (["takeover_required", "fault"].includes(s.mode)) throw new Error("Clear the scenario and acknowledge takeover manually.");
    }
    if (args.action === "engage" && s.scenario !== "clear" && s.scenario !== "slowing_lead") {
      throw new Error("Clear the road condition before engagement.");
    }
    for (const key of patch) s[key] = args[key];
    if (args.action === "engage") { s.mode = "active"; s.reason = null; }
    if (args.action === "disengage" && !["takeover_required", "fault"].includes(s.mode)) this.halt(null);
    s.rev++;
    return this.snapshot();
  }
  scenario(name) {
    if (!["clear", "slowing_lead", "lane_loss", "obstacle"].includes(name)) throw new Error("Unknown scenario.");
    this.state.scenario = name;
    this.state.lane_visible = name !== "lane_loss";
    this.state.lead_distance_m = name === "obstacle" ? 8 : 70;
    this.elapsed = 0;
    this.state.rev++;
  }
  acknowledge() {
    if (this.state.scenario !== "clear" || !this.visible || !this.connected || !this.bodyReady) {
      throw new Error("Select clear road conditions and restore the control connection first.");
    }
    Object.assign(this.state, { mode: "disengaged", reason: null, rev: this.state.rev + 1 });
  }
  advance(seconds, reference = null) {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 60) throw new Error("Invalid simulator time step.");
    const s = this.state;
    if (reference) {
      if (!Number.isFinite(reference.speedKmh) || reference.speedKmh < 0 ||
          !Number.isFinite(reference.distanceM) || reference.distanceM < 0 ||
          this.reference && reference.distanceM < this.reference.distanceM) {
        throw new Error("Invalid EPA driving sample.");
      }
      if (s.mode !== "active") {
        if (this.reference) s.distance_m += reference.distanceM - this.reference.distanceM;
        s.actual_speed_kmh = reference.speedKmh;
        s.lane_offset = 0;
      }
      this.reference = { ...reference };
    }
    if (s.mode !== "active") { this.remainder = 0; return this.snapshot(); }
    this.remainder += seconds;
    while (this.remainder + 1e-9 >= .02 && s.mode === "active") {
      this.remainder -= .02;
      this.tick(.02);
    }
    return this.snapshot();
  }
  tick(dt) {
    const s = this.state;
    this.elapsed += dt;
    if (s.mode === "active" && (s.scenario === "obstacle" || !s.lane_visible || s.lead_distance_m < 5)) {
      this.halt(s.scenario === "obstacle" ? "Obstacle: take over" : !s.lane_visible ? "Lane markers lost: take over" : "Lead car too close: take over", true);
      return;
    }
    const leadSpeed = s.scenario === "slowing_lead" && this.elapsed > 3 ? 20 : 80;
    const desiredGap = 5 + s.following_gap * .5 * s.actual_speed_kmh / 3.6;
    let target = s.mode === "active" ? s.target_speed_kmh : 0;
    if (s.mode === "active" && s.lead_distance_m < desiredGap + 15) target = Math.min(target, leadSpeed);
    const difference = target - s.actual_speed_kmh;
    s.actual_speed_kmh += Math.sign(difference) * Math.min(Math.abs(difference), (difference > 0 ? 7.2 : 12) * dt);
    s.distance_m += s.actual_speed_kmh / 3.6 * dt;
    s.lead_distance_m = Math.min(120, s.lead_distance_m + (leadSpeed - s.actual_speed_kmh) / 3.6 * dt);
    s.lane_offset = s.lane_keeping && s.mode === "active" ? s.lane_offset * .97 : Math.sin(this.elapsed * .2) * .15;
  }
}

export const autopilot = new AutopilotSimulator();
export const motionSource = { get value() { return autopilot.state.mode === "active" ? "simulator" : "reference"; } };
