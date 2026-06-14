// Measures how long a controller input waits between arriving at the backend
// and being latched into the emulator tick that applies it. One observation
// per newly-received state: re-sends before the next tick keep the EARLIEST
// pending timestamp (the worst case is the honest one), and a drain clears the
// seat until new input arrives. Standalone so the semantics are unit-testable
// without booting wasm.
export class InputLatencyTracker {
  private readonly pending: (number | undefined)[];
  private readonly now: () => number;

  constructor(seats: number, now: () => number = () => performance.now()) {
    // No mapper: Array.from of a bare length yields undefined slots, which is
    // exactly the "nothing pending" state.
    this.pending = Array.from<number | undefined>({ length: seats });
    this.now = now;
  }

  /** Mark a seat as having fresh input awaiting its first tick. */
  record(seat: number): void {
    if (seat < 0 || seat >= this.pending.length) return;
    this.pending[seat] ??= this.now();
  }

  /** Drop a pending sample (e.g. the player disconnected before a tick). */
  clear(seat: number): void {
    if (seat < 0 || seat >= this.pending.length) return;
    this.pending[seat] = undefined;
  }

  /** Observe and clear every pending seat (call once per tick, at latch time). */
  drainAll(observe: (delayMs: number) => void): void {
    const t = this.now();
    for (let seat = 0; seat < this.pending.length; seat++) {
      const recordedAt = this.pending[seat];
      if (recordedAt === undefined) continue;
      observe(t - recordedAt);
      this.pending[seat] = undefined;
    }
  }
}
