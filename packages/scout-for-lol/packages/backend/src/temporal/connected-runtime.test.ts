import { describe, expect, test } from "vitest";
import {
  discardPartialRuntime,
  reconnectDelayMs,
} from "#src/temporal/connected-runtime.ts";

/**
 * The SDK invariant these fakes model: `Worker.create` registers a reference
 * holder on the native connection immediately, and only releases it once the
 * worker's `run()` promise settles. Closing a connection that still has a
 * holder throws `IllegalStateError`. A fake that did not model this would
 * happily pass against the very bug the release path exists to prevent —
 * cleanup that closed first, threw, and discarded the real failure with it.
 */
class ConnectionHolders {
  readonly #holders = new Set<object>();

  hold(holder: object): void {
    this.#holders.add(holder);
  }

  release(holder: object): void {
    this.#holders.delete(holder);
  }

  get size(): number {
    return this.#holders.size;
  }
}

class FakeWorker {
  #state = "INITIALIZED";
  #settleRun: (() => void) | undefined;
  ranCount = 0;
  shutdownCount = 0;
  releasesOnShutdown = true;

  constructor(private readonly holders: ConnectionHolders) {
    holders.hold(this);
  }

  getState(): string {
    return this.#state;
  }

  run(): Promise<void> {
    this.ranCount += 1;
    this.#state = "RUNNING";
    return new Promise<void>((resolve) => {
      this.#settleRun = () => {
        this.#state = "STOPPED";
        this.holders.release(this);
        resolve();
      };
    });
  }

  shutdown(): void {
    this.shutdownCount += 1;
    if (this.releasesOnShutdown) this.#settleRun?.();
  }
}

class FakeConnection {
  didClose = false;

  constructor(
    private readonly holders?: ConnectionHolders,
    private readonly failWith?: string,
  ) {}

  async close(): Promise<void> {
    await Promise.resolve();
    if (this.failWith !== undefined) throw new Error(this.failWith);
    if (this.holders !== undefined && this.holders.size > 0) {
      throw new Error(
        "Cannot close connection while Workers hold a reference to it",
      );
    }
    this.didClose = true;
  }
}

describe("discardPartialRuntime", () => {
  test("drains created workers so the native connection can close", async () => {
    const holders = new ConnectionHolders();
    const workers = [new FakeWorker(holders), new FakeWorker(holders)];
    const nativeConnection = new FakeConnection(holders);
    const clientConnection = new FakeConnection();
    expect(holders.size).toBe(2);

    await discardPartialRuntime(
      { workers, clientConnection, nativeConnection },
      new Error("original failure"),
    );

    expect(holders.size).toBe(0);
    for (const worker of workers) {
      expect(worker.ranCount).toBe(1);
      expect(worker.shutdownCount).toBe(1);
    }
    expect(clientConnection.didClose).toBe(true);
    expect(nativeConnection.didClose).toBe(true);
  });

  test("never throws, so the caller's original error survives cleanup", async () => {
    const holders = new ConnectionHolders();
    const stuck = new FakeWorker(holders);
    // Reproduces the state that used to raise IllegalStateError from inside
    // the catch block and replace the failure that caused it.
    stuck.releasesOnShutdown = false;
    const nativeConnection = new FakeConnection(holders);

    await expect(
      discardPartialRuntime(
        { workers: [stuck], clientConnection: undefined, nativeConnection },
        new Error("original failure"),
        // Bounded so a wedged worker cannot stall the reconnect loop; the
        // production default is longer than the workers' force-shutdown.
        10,
      ),
    ).resolves.toBeUndefined();

    expect(stuck.shutdownCount).toBe(1);
    expect(nativeConnection.didClose).toBe(false);
  });

  test("closes the native connection even when the client close fails", async () => {
    const holders = new ConnectionHolders();
    const nativeConnection = new FakeConnection(holders);
    const clientConnection = new FakeConnection(
      undefined,
      "client close failed",
    );

    await discardPartialRuntime(
      { workers: [], clientConnection, nativeConnection },
      new Error("original failure"),
    );

    expect(clientConnection.didClose).toBe(false);
    expect(nativeConnection.didClose).toBe(true);
  });

  test("handles a runtime that failed before any worker existed", async () => {
    const holders = new ConnectionHolders();
    const nativeConnection = new FakeConnection(holders);

    await discardPartialRuntime(
      { workers: [], clientConnection: undefined, nativeConnection },
      new Error("connect failed"),
    );

    expect(nativeConnection.didClose).toBe(true);
  });
});

describe("reconnectDelayMs", () => {
  test("retries the first failure promptly", () => {
    expect(reconnectDelayMs(0)).toBe(5000);
    expect(reconnectDelayMs(1)).toBe(5000);
  });

  test("backs off exponentially", () => {
    expect(reconnectDelayMs(2)).toBe(10_000);
    expect(reconnectDelayMs(3)).toBe(20_000);
    expect(reconnectDelayMs(4)).toBe(40_000);
  });

  test("caps the delay so a stuck supervisor cannot spin", () => {
    expect(reconnectDelayMs(5)).toBe(60_000);
    expect(reconnectDelayMs(50)).toBe(60_000);
    expect(reconnectDelayMs(334)).toBe(60_000);
  });
});
