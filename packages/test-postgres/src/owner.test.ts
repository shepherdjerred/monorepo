import { describe, expect, test } from "vitest";
import {
  type DatabaseOwner,
  decideStaleTemplatePrune,
  decideSweep,
  decideTemplateRebuild,
  formatOwnerComment,
  LEGACY_SCOUT_OWNER_MARKER,
  OWNER_MARKER,
  type OwnerRecord,
  parseOwnerComment,
  type ProcessProbe,
  STALE_TEMPLATE_MAX_AGE_MS,
  SWEEP_GRACE_MS,
} from "./owner.ts";

const HOST = "macbook";
const NOW = 1_800_000_000_000;
const STARTED = "Sun Nov 15 22:00:00 2026";

const baseOwner: DatabaseOwner = {
  host: HOST,
  pid: 9999,
  processStart: STARTED,
  createdAt: NOW - SWEEP_GRACE_MS - 1,
};

function probe(processes: Record<number, string | undefined>): ProcessProbe {
  return {
    host: HOST,
    isAlive: (pid) => pid in processes,
    startTime: (pid) => processes[pid],
  };
}

const deadProbe = probe({});
const liveProbe = probe({ [baseOwner.pid]: STARTED });

describe("owner comments (monorepo-test-owner/v1 + scout-test-owner/v1)", () => {
  test("formats with monorepo-test-owner/v1 and round-trips", () => {
    const formatted = formatOwnerComment(baseOwner);
    expect(formatted.startsWith(OWNER_MARKER)).toBe(true);
    expect(parseOwnerComment(formatted)).toEqual({
      kind: "owned",
      owner: baseOwner,
    });
  });

  test("parses legacy scout-test-owner/v1 comments for backward compatibility", () => {
    const legacy = `${LEGACY_SCOUT_OWNER_MARKER}${JSON.stringify(baseOwner)}`;
    expect(parseOwnerComment(legacy)).toEqual({
      kind: "owned",
      owner: baseOwner,
    });
  });

  test("flags malformed comments and treats unknown comments as unowned", () => {
    expect(parseOwnerComment(`${OWNER_MARKER}{broken`)).toEqual({
      kind: "malformed",
      comment: `${OWNER_MARKER}{broken`,
    });
    expect(
      parseOwnerComment(`${LEGACY_SCOUT_OWNER_MARKER}{"pid":"bad"}`),
    ).toEqual({
      kind: "malformed",
      comment: `${LEGACY_SCOUT_OWNER_MARKER}{"pid":"bad"}`,
    });
    expect(parseOwnerComment(null)).toEqual({ kind: "none" });
    expect(parseOwnerComment("manual dev database")).toEqual({ kind: "none" });
  });
});

describe("sweep and stale template pruning decisions", () => {
  const ownedRecord: OwnerRecord = { kind: "owned", owner: baseOwner };

  test("drops dead same-host owner past grace with 0 connections, keeps live or foreign", () => {
    expect(
      decideSweep({
        record: ownedRecord,
        activeConnections: 0,
        now: NOW,
        probe: deadProbe,
      }),
    ).toEqual({ action: "drop" });

    expect(
      decideSweep({
        record: ownedRecord,
        activeConnections: 0,
        now: NOW,
        probe: liveProbe,
      }),
    ).toEqual({ action: "keep", reason: "owner-alive" });

    expect(
      decideSweep({
        record: { kind: "owned", owner: { ...baseOwner, host: "remote-ci" } },
        activeConnections: 0,
        now: NOW,
        probe: deadProbe,
      }),
    ).toEqual({ action: "keep", reason: "foreign-host" });
  });

  test("drops incomplete partial template only when builder is gone", () => {
    expect(
      decideTemplateRebuild({
        exists: true,
        record: ownedRecord,
        wantedHash: "f".repeat(64),
        activeConnections: 0,
        probe: deadProbe,
      }),
    ).toEqual({ action: "drop-partial" });

    expect(
      decideTemplateRebuild({
        exists: true,
        record: ownedRecord,
        wantedHash: "f".repeat(64),
        activeConnections: 0,
        probe: liveProbe,
      }).action,
    ).toBe("refuse");
  });

  test("prunes superseded templates only when >24h old and 0 active connections", () => {
    const oldOwner: OwnerRecord = {
      kind: "owned",
      owner: {
        ...baseOwner,
        createdAt: NOW - STALE_TEMPLATE_MAX_AGE_MS - 1000,
        templateHash: "0".repeat(64),
      },
    };
    const recentOwner: OwnerRecord = {
      kind: "owned",
      owner: {
        ...baseOwner,
        createdAt: NOW - 60_000,
        templateHash: "0".repeat(64),
      },
    };

    expect(
      decideStaleTemplatePrune({
        databaseName: "delivery_template_0000000000000000",
        currentTemplateName: "delivery_template_1111111111111111",
        record: oldOwner,
        activeConnections: 0,
        now: NOW,
        probe: liveProbe,
      }),
    ).toEqual({ action: "drop" });

    expect(
      decideStaleTemplatePrune({
        databaseName: "delivery_template_0000000000000000",
        currentTemplateName: "delivery_template_1111111111111111",
        record: recentOwner,
        activeConnections: 0,
        now: NOW,
        probe: deadProbe,
      }),
    ).toEqual({ action: "keep", reason: "within-retention" });

    expect(
      decideStaleTemplatePrune({
        databaseName: "delivery_template_0000000000000000",
        currentTemplateName: "delivery_template_1111111111111111",
        record: oldOwner,
        activeConnections: 1,
        now: NOW,
        probe: deadProbe,
      }),
    ).toEqual({ action: "keep", reason: "active-connections" });
  });
});
