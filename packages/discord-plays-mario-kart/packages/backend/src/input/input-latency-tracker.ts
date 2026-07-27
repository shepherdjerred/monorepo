// Measures how long a controller input waits between arriving at the backend
// and being latched into the emulator tick that applies it. One observation
// per newly-received state: re-sends before the next tick keep the EARLIEST
// pending timestamp (the worst case is the honest one), and a drain clears the
// seat until new input arrives. Standalone so the semantics are unit-testable
// without booting wasm.
//
// Timestamps are an ABSOLUTE, cross-thread clock (`performance.timeOrigin +
// performance.now()`, i.e. high-resolution epoch ms) so a receipt time captured
// on the main thread stays comparable to the drain time taken on the emulator
// Worker thread — each thread's `performance.now()` has its own origin, but the
// origins are absolute, so origin+now is a single shared timeline.
export class InputLatencyTracker {
  private readonly pending: (number | undefined)[];
  private readonly now: () => number;

  constructor(
    seats: number,
    now: () => number = () => performance.timeOrigin + performance.now(),
  ) {
    // No mapper: Array.from of a bare length yields undefined slots, which is
    // exactly the "nothing pending" state.
    this.pending = Array.from<number | undefined>({ length: seats });
    this.now = now;
  }

  /**
   * Mark a seat as having fresh input awaiting its first tick. `at` is the
   * absolute receipt timestamp (see class note); pass the main-thread arrival
   * time so the boundary transit is included, or omit it to stamp now.
   */
  record(seat: number, at?: number): void {
    if (seat < 0 || seat >= this.pending.length) return;
    this.pending[seat] ??= at ?? this.now();
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
