import { describe, expect, test } from "vitest";
import {
  closeDuckDB,
  duckDbSpillBudgets,
  ReportQueryTimeoutError,
  withDuckDBConnection,
  withMaintenanceDuckDBConnection,
} from "./instance.ts";

describe("duckDbSpillBudgets", () => {
  // REPORT_DUCKDB_MAX_TEMP_SIZE as homelab sets it: the 8 GiB scratch volume
  // (SCOUT_DUCKDB_SCRATCH.sizeLimit) less 1 GiB headroom.
  const DEPLOYED_SPILL_BUDGET = "7GiB";
  const GIB = 1024 ** 3;

  test("both instances together never spill more than the volume budget", () => {
    for (const [budget, bytes] of [
      [DEPLOYED_SPILL_BUDGET, 7 * GIB],
      ["3GiB", 3 * GIB],
      ["1GiB", GIB],
      ["512MiB", 512 * 1024 ** 2],
      ["7GB", 7e9],
    ] as const) {
      const caps = duckDbSpillBudgets(budget);
      expect(
        caps.reportBytes + caps.maintenanceBytes,
        budget,
      ).toBeLessThanOrEqual(bytes);
      expect(caps.maintenanceBytes, budget).toBeGreaterThan(0);
    }
    const deployed = duckDbSpillBudgets(DEPLOYED_SPILL_BUDGET);
    expect(
      deployed.reportBytes + deployed.maintenanceBytes,
    ).toBeLessThanOrEqual(7 * GIB);
    expect(deployed).toEqual({
      reportBytes: 6 * GIB,
      maintenanceBytes: GIB,
      report: "6144MiB",
      maintenance: "1024MiB",
    });
  });

  test("a small budget gives maintenance at most a quarter", () => {
    const caps = duckDbSpillBudgets("2GB");
    expect(caps.maintenanceBytes).toBeLessThanOrEqual(2e9 / 4);
    expect(caps.reportBytes + caps.maintenanceBytes).toBeLessThanOrEqual(2e9);
  });

  test("refuses a size it cannot read", () => {
    expect(() => duckDbSpillBudgets("lots")).toThrow(/Not a DuckDB size/u);
  });

  test("DuckDB accepts both caps as settings", async () => {
    const caps = duckDbSpillBudgets(DEPLOYED_SPILL_BUDGET);
    await withMaintenanceDuckDBConnection(async (session) => {
      await session.run(`SET max_temp_directory_size = '${caps.report}'`);
      await session.run(`SET max_temp_directory_size = '${caps.maintenance}'`);
      return [];
    });
  });
});

describe("withMaintenanceDuckDBConnection", () => {
  test("runs lake maintenance while both report slots are busy, and takes none", async () => {
    const reportsHeld = Promise.withResolvers<undefined>();
    const bothStarted = Promise.withResolvers<undefined>();
    let started = 0;
    const reports = Array.from(
      { length: 2 },
      async () =>
        await withDuckDBConnection(async () => {
          started++;
          if (started === 2) bothStarted.resolve(undefined);
          await reportsHeld.promise;
          return [];
        }),
    );
    await bothStarted.promise;

    const maintenance = await withMaintenanceDuckDBConnection(
      async (session) => await session.run("select 7 as value"),
      { timeoutMs: 5000 },
    );
    expect(maintenance).toEqual([{ value: 7 }]);

    // A third report query still waits: maintenance did not free a slot.
    const third = withDuckDBConnection(
      async (session) => await session.run("select 8 as value"),
      { timeoutMs: 50 },
    );
    await expect(third).rejects.toBeInstanceOf(ReportQueryTimeoutError);

    reportsHeld.resolve(undefined);
    await Promise.all(reports);
  });

  test("runs one maintenance connection at a time", async () => {
    let active = 0;
    let maximumActive = 0;
    const run = async () =>
      await withMaintenanceDuckDBConnection(async (session) => {
        active++;
        maximumActive = Math.max(maximumActive, active);
        await session.run("select 1");
        await Bun.sleep(5);
        active--;
      });
    await Promise.all([run(), run(), run()]);
    expect(maximumActive).toBe(1);
  });
});

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

  test("includes semaphore wait in the query timeout", async () => {
    const queryGate = Promise.withResolvers<undefined>();
    const twoStarted = Promise.withResolvers<undefined>();
    let started = 0;
    const blockers = Array.from(
      { length: 2 },
      async () =>
        await withDuckDBConnection(async () => {
          started++;
          if (started === 2) twoStarted.resolve(undefined);
          await queryGate.promise;
          return [];
        }),
    );

    await twoStarted.promise;
    const queued = withDuckDBConnection(async () => [], { timeoutMs: 20 });
    try {
      await expect(queued).rejects.toBeInstanceOf(ReportQueryTimeoutError);
    } finally {
      queryGate.resolve(undefined);
      await Promise.all(blockers);
    }
  });

  test("interrupts an in-flight query when its caller aborts", async () => {
    const controller = new AbortController();
    const query = withDuckDBConnection(
      async (session) =>
        await session.run(
          "SELECT COUNT(*) FROM range(200000000) a, range(50) b",
        ),
      { abortSignal: controller.signal },
    );
    setTimeout(() => controller.abort(), 50);

    await expect(query).rejects.toThrow(/aborted/i);
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
