/** Defers an idle teardown while a final spoken confirmation is draining. */
export class TeardownHold {
  private holds = 0;
  private requested = false;
  private waiters: (() => void)[] = [];

  /**
   * The single owner callback. Requests made while held fire this exact callback on release —
   * taking a callback per request()/acquire() call invited two different callbacks where only
   * one could ever run.
   */
  constructor(private readonly teardown: () => void) {}

  request(): void {
    if (this.holds > 0) {
      this.requested = true;
      return;
    }
    this.teardown();
  }

  acquire(): () => void {
    this.holds += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds -= 1;
      if (this.holds > 0) return;
      const waiters = this.waiters;
      this.waiters = [];
      for (const resolve of waiters) resolve();
      if (this.requested) {
        // Reset before firing so a hold acquired after this teardown cannot replay the stale
        // request when it releases.
        this.requested = false;
        this.teardown();
      }
    };
  }

  /**
   * Resolves once nothing holds the session open. The voice disconnect waits on this so a held
   * transaction can still speak its confirmation over the normal voice connection; the hold is
   * itself bounded by the voice transaction timeout, so this never waits indefinitely.
   */
  drain(): Promise<void> {
    if (this.holds === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}
