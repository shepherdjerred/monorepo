/** Defers an idle teardown while a final spoken confirmation is draining. */
export class TeardownHold {
  private holds = 0;
  private requested = false;

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
      if (this.holds === 0 && this.requested) teardown();
    };
  }
}
