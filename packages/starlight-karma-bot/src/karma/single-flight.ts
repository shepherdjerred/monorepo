/** Run at most one asynchronous operation at a time.
 *
 * Timer callbacks cannot await one another. This small gate makes overlapping
 * ticks explicit: the first runs to completion and later ticks are skipped. */
export class SingleFlight {
  private running = false;

  async run(operation: () => Promise<void>): Promise<boolean> {
    if (this.running) {
      return false;
    }

    this.running = true;
    try {
      await operation();
      return true;
    } finally {
      this.running = false;
    }
  }
}
