import { describe, expect, test } from "vitest";
import { closeDuckDB, withDuckDBConnection } from "./instance.ts";

/**
 * The instance is a process-wide singleton the server keeps for its lifetime.
 * A CLI is the other case: left to finalization the native handle delays exit
 * after the work is done, so a script releases it explicitly.
 */
describe("closeDuckDB", () => {
  test("is a no-op before any query has created an instance", async () => {
    await expect(closeDuckDB()).resolves.toBeUndefined();
  });

  test("releases the instance and lets a later query rebuild one", async () => {
    const before = await withDuckDBConnection(async (session) =>
      session.run("select 1 as value"),
    );
    expect(before).toEqual([{ value: 1 }]);

    await closeDuckDB();

    const after = await withDuckDBConnection(async (session) =>
      session.run("select 2 as value"),
    );
    expect(after).toEqual([{ value: 2 }]);
  });

  test("is idempotent, so a CLI may close in a finally and again on exit", async () => {
    await withDuckDBConnection(async (session) =>
      session.run("select 1 as value"),
    );
    await closeDuckDB();
    await expect(closeDuckDB()).resolves.toBeUndefined();
  });
});

describe("withDuckDBConnection concurrency", () => {
  test("keeps at most two report queries active per process", async () => {
    let active = 0;
    let maximumActive = 0;
    let started = 0;
    const queryGate = Promise.withResolvers<boolean>();
    const twoStarted = Promise.withResolvers<boolean>();

    const run = async () =>
      await withDuckDBConnection(async () => {
        active++;
        maximumActive = Math.max(maximumActive, active);
        started++;
        if (started === 2) twoStarted.resolve(true);
        await queryGate.promise;
        active--;
        return [];
      });

    const queries = [run(), run(), run()];
    await twoStarted.promise;
    expect(started).toBe(2);
    queryGate.resolve(true);
    await Promise.all(queries);

    expect(maximumActive).toBe(2);
    expect(started).toBe(3);
  });

  test("disables insertion order preservation on the shared instance", async () => {
    const result = await withDuckDBConnection(async (session) =>
      session.run(
        "select current_setting('preserve_insertion_order') as enabled",
      ),
    );

    expect(result).toEqual([{ enabled: false }]);
  });
});
