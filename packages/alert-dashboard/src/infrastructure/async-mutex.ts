function noop(): void {
  return;
}

export class AsyncMutex {
  #tail = Promise.resolve();

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    let release = noop;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.#tail;
    this.#tail = (async () => {
      await previous;
      await turn;
    })();
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
