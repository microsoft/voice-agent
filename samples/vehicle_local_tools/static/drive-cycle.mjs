export const MPH_TO_KMH = 1.609344;
// The source mesh has no physical units; assume a 0.34 m tire radius for this demo.
export const WHEEL_RADIUS_M = 0.34;

export class FTP75Cycle {
  constructor(text) {
    const lines = text.trim().split(/\r?\n/);
    if (!lines[0].startsWith("FTPCOL.TXT")) throw new Error("Expected the official EPA FTP-75 trace.");
    const rows = lines.slice(2).filter((line) => line.trim()).map((line) => line.trim().split(/\s+/).map(Number));
    if (rows.length !== 1875 || rows.some((row, index) =>
      row.length !== 2 || row[0] !== index || !Number.isFinite(row[1]) || row[1] < 0)) {
      throw new Error("The EPA FTP-75 trace must contain seconds 0 through 1874.");
    }
    this.speeds = rows.map((row) => row[1] * MPH_TO_KMH);
    this.duration = this.speeds.length - 1;
    this.distances = [0];
    for (let i = 1; i < this.speeds.length; i++) {
      this.distances.push(this.distances[i - 1] + (this.speeds[i - 1] + this.speeds[i]) / 7.2);
    }
  }

  sample(elapsedSeconds) {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) throw new Error("Invalid simulation time.");
    const cycleSeconds = elapsedSeconds % this.duration;
    const index = Math.floor(cycleSeconds), fraction = cycleSeconds - index;
    const speed = this.speeds[index], change = this.speeds[index + 1] - speed;
    const distanceM = Math.floor(elapsedSeconds / this.duration) * this.distances[this.duration]
      + this.distances[index] + (speed * fraction + change * fraction * fraction / 2) / 3.6;
    return { speedKmh: speed + change * fraction, distanceM, cycleSeconds, durationSeconds: this.duration };
  }
}

export class DriveClock {
  constructor(cycle, startedAt) {
    if (!Number.isFinite(startedAt)) throw new Error("Invalid simulation start time.");
    this.cycle = cycle;
    this.startedAt = startedAt;
  }

  sample(now) {
    return this.cycle.sample(Math.max(0, now - this.startedAt) / 1000);
  }
}

export let driveClock = null;
export function initializeDriveCycle(text, now) {
  const cycle = new FTP75Cycle(text);
  const firstMovingSecond = cycle.speeds.findIndex((speed) => speed > 0);
  driveClock = new DriveClock(cycle, now - firstMovingSecond * 1000);
}

export function wheelAngleForDistance(distanceM) {
  return (distanceM / WHEEL_RADIUS_M) % (2 * Math.PI);
}
