/** Serialize lifecycle effects for one container without blocking unrelated sandboxes. */
export class SandboxLifecycle {
  private readonly turns = new Map<string, Promise<null>>();

  async run<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.turns.get(id);
    const turn = Promise.withResolvers<null>();
    this.turns.set(id, turn.promise);
    await previous;
    try {
      return await operation();
    } finally {
      turn.resolve(null);
      if (this.turns.get(id) === turn.promise) this.turns.delete(id);
    }
  }
}
