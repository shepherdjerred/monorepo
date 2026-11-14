import { describe, expect, test } from "vitest";

import {
  type DatabaseOwner,
  decideSweep,
  decideTemplateRebuild,
  formatOwnerComment,
  type OwnerRecord,
  parseOwnerComment,
  type ProcessProbe,
  SWEEP_GRACE_MS,
} from "./test-database-owner.ts";

const HOST = "karpathy";
const NOW = 1_800_000_000_000;
const STARTED = "Sat Nov 14 10:00:00 2026";

const owner: DatabaseOwner = {
  host: HOST,
  pid: 4242,
  processStart: STARTED,
  createdAt: NOW - SWEEP_GRACE_MS - 1,
};
const owned = (overrides: Partial<DatabaseOwner> = {}): OwnerRecord => ({
  kind: "owned",
  owner: { ...owner, ...overrides },
});

function probe(processes: Record<number, string | undefined>): ProcessProbe {
  return {
    host: HOST,
    isAlive: (pid) => pid in processes,
    startTime: (pid) => processes[pid],
  };
}

const dead = probe({});
const live = probe({ [owner.pid]: STARTED });

function sweep(
  record: OwnerRecord,
  processProbe: ProcessProbe,
  activeConnections = 0,
) {
  return decideSweep({
    record,
    activeConnections,
    now: NOW,
    probe: processProbe,
  });
}

describe("sweep ownership decision", () => {
  test("drops a database whose same-host owner is dead", () => {
    expect(sweep(owned(), dead)).toEqual({ action: "drop" });
  });

  test("keeps a database whose same-host owner is alive", () => {
    expect(sweep(owned(), live)).toEqual({
      action: "keep",
      reason: "owner-alive",
    });
  });

  test("drops a database whose owner PID was reused by a later process", () => {
    expect(
      sweep(owned(), probe({ [owner.pid]: "Sat Nov 14 12:30:00 2026" })),
    ).toEqual({ action: "drop" });
  });

  test("keeps a database owned by another host even when the PID is free here", () => {
    expect(sweep(owned({ host: "other-host" }), dead)).toEqual({
      action: "keep",
      reason: "foreign-host",
    });
  });

  test("keeps a database with no owner record, however old", () => {
    expect(sweep({ kind: "none" }, dead)).toEqual({
      action: "keep",
      reason: "unowned",
    });
  });

  test("keeps a database whose owner record does not parse", () => {
    expect(
      sweep(parseOwnerComment('scout-test-owner/v1 {"pid":"x"}'), dead),
    ).toEqual({ action: "keep", reason: "malformed-owner" });
  });

  test("keeps an old database while its owner is alive", () => {
    expect(sweep(owned({ createdAt: NOW - 7 * 24 * 3_600_000 }), live)).toEqual(
      { action: "keep", reason: "owner-alive" },
    );
  });

  test("keeps a dead owner's database inside the grace period", () => {
    expect(sweep(owned({ createdAt: NOW - 1000 }), dead)).toEqual({
      action: "keep",
      reason: "within-grace",
    });
  });

  test("keeps a dead owner's database that still has connections", () => {
    expect(sweep(owned(), dead, 2)).toEqual({
      action: "keep",
      reason: "active-connections",
    });
  });

  test("keeps a database whose live owner's start time cannot be read", () => {
    expect(sweep(owned(), probe({ [owner.pid]: undefined }))).toEqual({
      action: "keep",
      reason: "owner-start-unknown",
    });
  });
});

describe("owner record comment", () => {
  test("round-trips through the database comment", () => {
    expect(parseOwnerComment(formatOwnerComment(owner))).toEqual({
      kind: "owned",
      owner,
    });
  });

  test("reads a missing or foreign comment as no owner record", () => {
    expect(parseOwnerComment(null)).toEqual({ kind: "none" });
    expect(parseOwnerComment("created by pgAdmin")).toEqual({ kind: "none" });
  });
});

describe("template rebuild decision", () => {
  const hash = "a".repeat(64);
  function rebuild(
    record: OwnerRecord,
    processProbe: ProcessProbe,
    activeConnections = 0,
  ) {
    return decideTemplateRebuild({
      exists: true,
      record,
      wantedHash: hash,
      activeConnections,
      probe: processProbe,
    });
  }

  test("creates a template that does not exist", () => {
    expect(
      decideTemplateRebuild({
        exists: false,
        record: { kind: "none" },
        wantedHash: hash,
        activeConnections: 0,
        probe: dead,
      }),
    ).toEqual({ action: "create" });
  });

  test("drops a partial build whose builder is dead", () => {
    expect(rebuild(owned(), dead)).toEqual({ action: "drop-partial" });
  });

  test("never drops a completed template", () => {
    expect(rebuild(owned({ templateHash: hash }), dead).action).toBe("refuse");
  });

  test("never drops a partial build whose builder is alive", () => {
    expect(rebuild(owned(), live).action).toBe("refuse");
  });

  test("never drops a template with no owner record", () => {
    expect(rebuild({ kind: "none" }, dead).action).toBe("refuse");
  });

  test("never drops a partial build that has connections", () => {
    expect(rebuild(owned(), dead, 1).action).toBe("refuse");
  });
});
