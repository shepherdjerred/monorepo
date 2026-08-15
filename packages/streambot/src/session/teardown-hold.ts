/** Defers an idle teardown while a final spoken confirmation is draining. */
export class TeardownHold {
  private holds = 0;
  private requested = false;
  private waiters: (() => void)[] = [];

  request(teardown: () => void): void {
    if (this.holds > 0) {
      this.requested = true;
      return;
    }
    teardown();
  }

  acquire(teardown: () => void): () => void {
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
      if (this.requested) teardown();
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
