/**
 * Serialize reaction mutations for one giver/message pair.
 *
 * Discord can deliver an add and a quick remove concurrently. Without a
 * per-reaction queue, the remove can observe no database row while the add is
 * still fetching a partial message, then the add commits after the reaction is
 * already gone. Different reactions remain independent.
 */
export class ReactionOperationQueue {
  private readonly busy = new Set<string>();
  private readonly waiters = new Map<string, (() => void)[]>();

  private async acquire(key: string): Promise<void> {
    if (!this.busy.has(key)) {
      this.busy.add(key);
      return;
    }

    await new Promise<undefined>((resolve) => {
      const resume = () => {
        resolve(undefined);
      };
      const queued = this.waiters.get(key);
      if (queued === undefined) {
        this.waiters.set(key, [resume]);
      } else {
        queued.push(resume);
      }
    });
  }

  private release(key: string): void {
    const queued = this.waiters.get(key);
    const next = queued?.shift();
    if (next === undefined) {
      this.waiters.delete(key);
      this.busy.delete(key);
      return;
    }
    next();
  }

  async run(key: string, operation: () => Promise<void>): Promise<void> {
    await this.acquire(key);
    try {
      await operation();
    } finally {
      this.release(key);
    }
  }
}
