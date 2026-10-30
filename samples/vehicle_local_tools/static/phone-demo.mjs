export class LocalPhone {
  constructor() {
    this.contacts = [];
    this.connected = false;
    this.state = { call_state: "idle", contact: null, direction: null, muted: false, rev: 0, reason: null };
    this.elapsed = 0;
  }
  configure(contacts) {
    if (!Array.isArray(contacts) || !contacts.length || contacts.length > 12
      || contacts.some((contact) => typeof contact !== "string" || !contact.trim() || contact.length > 64)
      || new Set(contacts).size !== contacts.length) throw new Error("Invalid local phone contacts.");
    this.contacts = [...contacts];
  }
  snapshot() {
    return { ...this.state, available: this.connected && this.contacts.length > 0,
      connected: false, calling_available: false, contacts: [...this.contacts],
      duration_seconds: this.state.call_state === "active" || this.state.call_state === "ended" ? Math.floor(this.elapsed) : 0 };
  }
  setConnected(connected) {
    if (typeof connected !== "boolean") throw new Error("Invalid phone connection state.");
    this.connected = connected;
    if (!connected && ["dialing", "incoming", "active"].includes(this.state.call_state)) this.end("Controls disconnected");
    return this.snapshot();
  }
  requireReady() {
    if (!this.snapshot().available) throw new Error("Local phone controls are disconnected.");
  }
  requireContact(contact) {
    if (!this.contacts.includes(contact)) throw new Error("Choose a listed contact.");
  }
  start(contact, direction) {
    this.requireReady(); this.requireContact(contact);
    if (!["idle", "ended"].includes(this.state.call_state)) throw new Error("End the current call first.");
    this.state = { call_state: direction === "incoming" ? "incoming" : "dialing",
      contact, direction, muted: false, rev: this.state.rev + 1, reason: null };
    this.elapsed = 0;
  }
  incoming(contact) {
    this.start(contact, "incoming");
    return this.snapshot();
  }
  end(reason) {
    if (this.state.call_state !== "active") this.elapsed = 0;
    this.state.call_state = "ended"; this.state.reason = reason; this.state.muted = false; this.state.rev++;
  }
  advance(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Invalid call-clock interval.");
    if (this.state.call_state === "dialing") {
      this.elapsed += seconds;
      if (this.elapsed >= 1.5) {
        this.elapsed -= 1.5;
        this.state.call_state = "active"; this.state.rev++;
      }
    } else if (this.state.call_state === "active") this.elapsed += seconds;
    return this.snapshot();
  }
  command(args, revision = this.state.rev) {
    this.requireReady();
    if (!args || typeof args !== "object" || Array.isArray(args)
      || Object.keys(args).some((key) => !["action", "contact"].includes(key))
      || !["dial", "answer", "reject", "end", "mute", "unmute"].includes(args.action)
      || (Object.hasOwn(args, "contact") !== (args.action === "dial"))) throw new Error("Invalid local phone command.");
    if (revision !== this.state.rev) throw new Error("Call state changed. Check the current call and retry.");
    const phase = this.state.call_state;
    if (args.action === "dial") this.start(args.contact, "outgoing");
    else if (args.action === "answer") {
      if (phase !== "incoming") throw new Error("There is no incoming call to answer.");
      this.state.call_state = "active"; this.elapsed = 0; this.state.rev++;
    } else if (args.action === "reject") {
      if (phase !== "incoming") throw new Error("There is no incoming call to reject.");
      this.end("Call declined");
    } else if (args.action === "end") {
      if (!["dialing", "incoming", "active"].includes(phase)) throw new Error("There is no call to end.");
      this.end("Call ended");
    } else {
      if (phase !== "active") throw new Error("Answer or connect the call before changing mute.");
      this.state.muted = args.action === "mute"; this.state.rev++;
    }
    return this.snapshot();
  }
}
