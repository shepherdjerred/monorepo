import { describe, expect, test } from "vitest";
import {
  assertOwnedEphemeralDatabaseName,
  decideExplicitDrop,
} from "./databases.ts";
import type { DatabaseOwner, ProcessProbe } from "./owner.ts";

const HOST = "macbook";
const CALLER_PID = 4242;
const CALLER_START = "Tue Nov 24 19:00:00 2026";
const OTHER_PID = 7777;
const OTHER_START = "Tue Nov 24 18:30:00 2026";

function makeProbe(
  processes: Readonly<Record<number, string | undefined>>,
): ProcessProbe {
  return {
    host: HOST,
    isAlive: (pid) => Object.hasOwn(processes, pid),
    startTime: (pid) => processes[pid],
  };
}

const baseOwner: DatabaseOwner = {
  host: HOST,
  pid: CALLER_PID,
  processStart: CALLER_START,
  createdAt: 1_800_000_000_000,
};

describe("assertOwnedEphemeralDatabaseName", () => {
  test("accepts managed *_test_* and *_mig_* names and rejects non-ephemeral databases", () => {
    expect(() =>
      assertOwnedEphemeralDatabaseName("scout_test_1234abcd"),
    ).not.toThrow();
    expect(() =>
      assertOwnedEphemeralDatabaseName("delivery_mig_abcd1234"),
    ).not.toThrow();
    expect(() => assertOwnedEphemeralDatabaseName("postgres")).toThrow(
      "Refusing to drop non-test database postgres",
    );
    expect(() =>
      assertOwnedEphemeralDatabaseName("scout_template_abcd1234"),
    ).toThrow("Refusing to drop non-test database scout_template_abcd1234");
  });
});

describe("decideExplicitDrop", () => {
  const dbName = "scout_test_explicit_drop";

  test("returns noop when database row is already absent", () => {
    expect(
      decideExplicitDrop({
        dbName,
        row: undefined,
        callerPid: CALLER_PID,
        callerProcessStart: CALLER_START,
        probe: makeProbe({ [CALLER_PID]: CALLER_START }),
      }),
    ).toEqual({ action: "noop" });
  });

  test("allows drop when owned by the calling process on the same host", () => {
    expect(
      decideExplicitDrop({
        dbName,
        row: { record: { kind: "owned", owner: baseOwner } },
        callerPid: CALLER_PID,
        callerProcessStart: CALLER_START,
        probe: makeProbe({ [CALLER_PID]: CALLER_START }),
      }),
    ).toEqual({ action: "drop" });
  });

  test("allows drop when same-host owner PID has exited or been recycled", () => {
    expect(
      decideExplicitDrop({
        dbName,
        row: {
          record: {
            kind: "owned",
            owner: {
              ...baseOwner,
              pid: OTHER_PID,
              processStart: OTHER_START,
            },
          },
        },
        callerPid: CALLER_PID,
        callerProcessStart: CALLER_START,
        probe: makeProbe({ [CALLER_PID]: CALLER_START }),
      }),
    ).toEqual({ action: "drop" });

    // Recycled PID with a newer start time counts as gone
    expect(
      decideExplicitDrop({
        dbName,
        row: {
          record: {
            kind: "owned",
            owner: {
              ...baseOwner,
              pid: OTHER_PID,
              processStart: OTHER_START,
            },
          },
        },
        callerPid: CALLER_PID,
        callerProcessStart: CALLER_START,
        probe: makeProbe({
          [CALLER_PID]: CALLER_START,
          [OTHER_PID]: "Tue Nov 24 19:05:00 2026",
        }),
      }),
    ).toEqual({ action: "drop" });
  });

  test("refuses untagged and malformed-owner databases", () => {
    const unowned = decideExplicitDrop({
      dbName,
      row: { record: { kind: "none" } },
      callerPid: CALLER_PID,
      callerProcessStart: CALLER_START,
      probe: makeProbe({}),
    });
    expect(unowned).toMatchObject({
      action: "refuse",
      reason: "unowned",
    });

    const malformed = decideExplicitDrop({
      dbName,
      row: {
        record: { kind: "malformed", comment: "monorepo-test-owner/v1 {bad" },
      },
      callerPid: CALLER_PID,
      callerProcessStart: CALLER_START,
      probe: makeProbe({}),
    });
    expect(malformed).toMatchObject({
      action: "refuse",
      reason: "malformed-owner",
    });
  });

  test("refuses foreign-host, another live owner PID, and unknown owner start time", () => {
    const foreign = decideExplicitDrop({
      dbName,
      row: {
        record: {
          kind: "owned",
          owner: { ...baseOwner, host: "karpathy-other" },
        },
      },
      callerPid: CALLER_PID,
      callerProcessStart: CALLER_START,
      probe: makeProbe({ [CALLER_PID]: CALLER_START }),
    });
    expect(foreign).toMatchObject({
      action: "refuse",
      reason: "foreign-host",
    });

    const liveOther = decideExplicitDrop({
      dbName,
      row: {
        record: {
          kind: "owned",
          owner: {
            ...baseOwner,
            pid: OTHER_PID,
            processStart: OTHER_START,
          },
        },
      },
      callerPid: CALLER_PID,
      callerProcessStart: CALLER_START,
      probe: makeProbe({
        [CALLER_PID]: CALLER_START,
        [OTHER_PID]: OTHER_START,
      }),
    });
    expect(liveOther).toMatchObject({
      action: "refuse",
      reason: "owner-alive",
    });

    const unknownStart = decideExplicitDrop({
      dbName,
      row: {
        record: {
          kind: "owned",
          owner: {
            ...baseOwner,
            pid: OTHER_PID,
            processStart: OTHER_START,
          },
        },
      },
      callerPid: CALLER_PID,
      callerProcessStart: CALLER_START,
      probe: makeProbe({
        [CALLER_PID]: CALLER_START,
        [OTHER_PID]: undefined,
      }),
    });
    expect(unknownStart).toMatchObject({
      action: "refuse",
      reason: "owner-start-unknown",
    });
  });
});
