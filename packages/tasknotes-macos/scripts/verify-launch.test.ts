import { describe, expect, test } from "vitest";
import {
  OwnedSmokeProcesses,
  executableMappingMatches,
  parseProcessTable,
  requireStartupMarker,
  SmokeLaunchGate,
  SmokeShutdownWedgedError,
  withSmokeCleanup,
  type SmokeProcess,
  type ExecutableMappingInspection,
} from "./verify-launch.ts";

const command =
  "/build with spaces/TaskNotes.app/Contents/MacOS/TaskNotes --facet-release-smoke run-a";
const processRecord: SmokeProcess = {
  pid: 123,
  uid: 501,
  startedAt: "Mon Oct 12 12:00:00 2026",
  command,
};

const mappingInspection: ExecutableMappingInspection = {
  pid: 123,
  status: 0,
  signal: null,
  timedOut: false,
  elapsedMs: 50,
  budgetMs: 5_000,
  pidMatches: true,
  pathMatches: true,
};

describe("executable inspector evidence", () => {
  test("requires successful inspection and both exact PID and executable mapping", () => {
    expect(executableMappingMatches(mappingInspection)).toBe(true);
    expect(
      executableMappingMatches({ ...mappingInspection, pidMatches: false }),
    ).toBe(false);
    expect(
      executableMappingMatches({ ...mappingInspection, pathMatches: false }),
    ).toBe(false);
    expect(
      executableMappingMatches({
        ...mappingInspection,
        status: 1,
        pidMatches: false,
        pathMatches: false,
      }),
    ).toBe(false);
  });

  test("rejects timed out, signaled or failed inspectors with closed diagnostics", () => {
    for (const inspection of [
      {
        ...mappingInspection,
        status: 137,
        signal: "SIGKILL",
        timedOut: true,
        elapsedMs: 5_001,
      },
      { ...mappingInspection, signal: "SIGTERM" },
      { ...mappingInspection, status: 2 },
      { ...mappingInspection, timedOut: true },
    ]) {
      expect(() => executableMappingMatches(inspection)).toThrow(
        JSON.stringify(inspection),
      );
    }
  });
});

function fixture(
  records: readonly SmokeProcess[] = [processRecord],
  baseline: readonly number[] = [],
) {
  let current = records;
  let now = 0;
  const signals: number[] = [];
  const runtime = {
    snapshot: async () => current,
    executableMatches: async (_pid: number) => true,
    signal(pid: number) {
      signals.push(pid);
      current = current.filter((record) => record.pid !== pid);
    },
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };
  const owner = new OwnedSmokeProcesses(
    runtime,
    command,
    501,
    new Set(baseline),
  );
  return {
    owner,
    runtime,
    signals,
    replace(records: readonly SmokeProcess[]) {
      current = records;
    },
  };
}

describe("Release startup attribution", () => {
  test("requires the exact run UUID and a valid owned process", () => {
    expect(() => requireStartupMarker("run-a", 123, "run-a\n")).not.toThrow();
    expect(() => requireStartupMarker("run-a", 123, "run-b\n")).toThrow();
    expect(() => requireStartupMarker("run-a", 123, "run-a")).toThrow();
    expect(() => requireStartupMarker("run-a", 0, "run-a\n")).toThrow();
  });

  test("parses full argv, UID and start time without trimming argument bytes", () => {
    expect(
      parseProcessTable(`  123  501 Mon Oct 12 12:00:00 2026 ${command}\n`),
    ).toEqual([processRecord]);
    expect(parseProcessTable("")).toEqual([]);
    expect(
      parseProcessTable(
        `123 501 Mon Oct 12 12:00:00 2026 ${command} extra\n`,
      )[0]?.command,
    ).toBe(`${command} extra`);
  });

  test("rejects malformed process snapshots instead of inventing ownership", () => {
    expect(() => parseProcessTable("123 nope\n")).toThrow("Malformed");
    expect(() =>
      parseProcessTable(`0 501 Mon Oct 12 12:00:00 2026 ${command}`),
    ).toThrow("Invalid");
    expect(() =>
      parseProcessTable(
        `9007199254740992 501 Mon Oct 12 12:00:00 2026 ${command}`,
      ),
    ).toThrow("Invalid");
  });

  test("accepts actual macOS comm output with a signed nobody UID", () => {
    expect(
      parseProcessTable(
        "    1     0 Fri Oct  9 16:53:29 2026     /sbin/launchd\n" +
          " 1059    -2 Fri Oct  9 16:54:15 2026     /usr/libexec/dhcp6d\n",
      ),
    ).toEqual([
      {
        pid: 1,
        uid: 0,
        startedAt: "Fri Oct  9 16:53:29 2026",
        command: "/sbin/launchd",
      },
      {
        pid: 1059,
        uid: 4_294_967_294,
        startedAt: "Fri Oct  9 16:54:15 2026",
        command: "/usr/libexec/dhcp6d",
      },
    ]);
    expect(
      parseProcessTable(`123 4294967294 Mon Oct 12 12:00:00 2026 ${command}`)[0]
        ?.uid,
    ).toBe(4_294_967_294);
  });

  test("rejects UIDs outside their signed or unsigned 32-bit representations", () => {
    for (const uid of [-2_147_483_649, 4_294_967_296]) {
      expect(() =>
        parseProcessTable(`123 ${uid} Mon Oct 12 12:00:00 2026 ${command}`),
      ).toThrow("Invalid");
    }
  });
});

describe("exact owned shutdown", () => {
  test("signals only the new exact instance, excluding baseline, other UID and other argv", async () => {
    const run = fixture(
      [
        processRecord,
        { ...processRecord, pid: 111 },
        { ...processRecord, pid: 222, uid: 502 },
        { ...processRecord, pid: 333, command: `${command} extra` },
        {
          ...processRecord,
          pid: 444,
          command: command.replace("run-a", "run-b"),
        },
        { ...processRecord, pid: 555, command: `helper ${command}` },
      ],
      [111],
    );
    await run.owner.shutdown();
    expect(run.signals).toEqual([123]);
  });

  test("a baseline-only or empty snapshot never signals a process", async () => {
    for (const run of [fixture([processRecord], [123]), fixture([])]) {
      await run.owner.shutdown();
      expect(run.signals).toEqual([]);
    }
  });

  test("PID reuse cannot inherit an earlier pinned lifetime", async () => {
    const run = fixture();
    expect(await run.owner.current()).toEqual([processRecord]);
    run.replace([{ ...processRecord, startedAt: "Mon Oct 12 12:00:01 2026" }]);
    await run.owner.shutdown();
    expect(run.signals).toEqual([]);
  });

  test("revalidates lifetime and UID after executable inspection before signaling", async () => {
    for (const changed of [
      { ...processRecord, startedAt: "Mon Oct 12 12:00:01 2026" },
      { ...processRecord, uid: 502 },
      { ...processRecord, command: `${command} extra` },
    ]) {
      const run = fixture();
      run.runtime.executableMatches = async () => {
        run.replace([changed]);
        return true;
      };
      await run.owner.shutdown();
      expect(run.signals).toEqual([]);
    }
  });

  test("an unverified executable fails closed without signaling", async () => {
    const run = fixture();
    run.runtime.executableMatches = async () => false;
    await expect(run.owner.shutdown()).rejects.toThrow("Cannot verify");
    expect(run.signals).toEqual([]);
  });

  test("a wedged process gets one SIGTERM and remains available for inspection", async () => {
    const run = fixture();
    run.runtime.signal = (pid) => {
      run.signals.push(pid);
    };
    await expect(
      withSmokeCleanup(
        () => run.owner.shutdown(),
        () => run.owner.shutdown(),
      ),
    ).rejects.toBeInstanceOf(SmokeShutdownWedgedError);
    expect(run.signals).toEqual([123]);
    expect(run.runtime.now()).toBe(5_000);
  });
});

describe("ordinary failure cleanup", () => {
  test("a missing startup marker terminates the exact owned app and preserves the failure", async () => {
    const run = fixture();
    const failure = new Error("startup did not complete: missing marker");
    await expect(
      withSmokeCleanup(
        async () => {
          throw failure;
        },
        () => run.owner.shutdown(),
      ),
    ).rejects.toBe(failure);
    expect(run.signals).toEqual([123]);
  });

  test("focus, provenance and unexpected failures also trigger cleanup", async () => {
    for (const failure of [
      new Error("focus changed"),
      new Error("provenance write failed"),
      new TypeError("unexpected boundary"),
    ]) {
      const run = fixture();
      await expect(
        withSmokeCleanup(
          async () => {
            throw failure;
          },
          () => run.owner.shutdown(),
        ),
      ).rejects.toBe(failure);
      expect(run.signals).toEqual([123]);
    }
  });

  test("reports both the original error and an owned cleanup failure", async () => {
    const run = fixture();
    run.runtime.executableMatches = async () => false;
    const failure = new Error("startup failed");
    try {
      await withSmokeCleanup(
        async () => {
          throw failure;
        },
        () => run.owner.shutdown(),
      );
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors[0]).toBe(failure);
      expect((error as AggregateError).errors[1]).toEqual(
        expect.objectContaining({
          message:
            "Cannot verify owned Release smoke executable before cleanup",
        }),
      );
    }
    expect(run.signals).toEqual([]);
  });

  test("successful completion also performs owned cleanup", async () => {
    const run = fixture();
    await withSmokeCleanup(
      async () => {},
      () => run.owner.shutdown(),
    );
    expect(run.signals).toEqual([123]);
  });
});

describe("Launch Services cancellation fence", () => {
  test("cancellation before launch prevents any external launch", async () => {
    let starts = 0;
    const gate = new SmokeLaunchGate(
      async () => {
        starts++;
      },
      async () => {},
    );
    gate.cancel();
    await expect(gate.launch()).rejects.toThrow("cancelled");
    await gate.settle();
    expect(starts).toBe(0);
  });

  test("cleanup waits for in-flight open and the adoption window before inspecting ownership", async () => {
    const run = fixture([]);
    const order: string[] = [];
    let finishOpen: () => void = () => {
      throw new Error("launch not started");
    };
    const open = new Promise<void>((resolve) => {
      finishOpen = resolve;
    });
    const gate = new SmokeLaunchGate(
      () => open,
      async () => {
        order.push("adopted");
        run.replace([processRecord]);
      },
    );
    const launched = gate.launch();
    gate.cancel();
    const cleanup = async () => {
      await gate.settle();
      order.push("cleanup");
      await run.owner.shutdown();
    };
    const cleaning = cleanup();
    await Promise.resolve();
    expect(order).toEqual([]);
    expect(run.signals).toEqual([]);
    finishOpen();
    await Promise.all([launched, cleaning]);
    expect(order).toEqual(["adopted", "cleanup"]);
    expect(run.signals).toEqual([123]);
  });

  test("a failed open still waits for delayed adoption before ordinary error cleanup", async () => {
    const run = fixture([]);
    const gate = new SmokeLaunchGate(
      async () => {
        throw new Error("open failed");
      },
      async () => {
        run.replace([processRecord]);
      },
    );
    await expect(
      withSmokeCleanup(
        () => gate.launch(),
        async () => {
          await gate.settle();
          await run.owner.shutdown();
        },
      ),
    ).rejects.toThrow("open failed");
    expect(run.signals).toEqual([123]);
  });
});
