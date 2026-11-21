import { describe, expect, test } from "vitest";
import {
  assembleSnapshot,
  rankSignals,
} from "@shepherdjerred/ops-model/assemble.ts";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import {
  actionableSignals,
  groupSignals,
  SIGNAL_GROUP_KINDS,
  type SignalEntry,
} from "@shepherdjerred/ops-model/signals/signal-groups.ts";
import { SOURCE_IDS, type Signal } from "@shepherdjerred/ops-model/snapshot.ts";

const BASE: Signal = {
  id: "base",
  source: "maintenance",
  section: "maintenance",
  kind: "restore-failure",
  severity: "warning",
  needsMe: true,
  title: "base",
  attributes: {},
  links: [],
};

function signal(id: string, overrides: Partial<Signal> = {}): Signal {
  return { ...BASE, id, title: id, ...overrides };
}

function many(
  count: number,
  prefix: string,
  overrides: Partial<Signal> = {},
): Signal[] {
  return Array.from({ length: count }, (_, index) =>
    signal(`${prefix}-${String(index)}`, overrides),
  );
}

/** `id` for a single row, `[label: member ids]` for a group. */
function shape(entries: readonly SignalEntry[]): string[] {
  return entries.map((entry) =>
    entry.type === "signal"
      ? entry.signal.id
      : `[${entry.label}: ${entry.signals.map((member) => member.id).join(",")}]`,
  );
}

function flatten(entries: readonly SignalEntry[]): Signal[] {
  return entries.flatMap((entry) =>
    entry.type === "signal" ? [entry.signal] : [...entry.signals],
  );
}

describe("groupSignals", () => {
  test("two same-kind signals stay individual; three collapse", () => {
    expect(shape(groupSignals(many(2, "restore")))).toEqual([
      "restore-0",
      "restore-1",
    ]);
    expect(shape(groupSignals(many(3, "restore")))).toEqual([
      "[3 failed Velero restores: restore-0,restore-1,restore-2]",
    ]);
  });

  test("minSize moves the threshold", () => {
    expect(groupSignals(many(2, "restore"), { minSize: 2 })).toHaveLength(1);
    expect(groupSignals(many(4, "restore"), { minSize: 5 })).toHaveLength(4);
  });

  test("alerts never collapse, however many fire", () => {
    const alerts = many(13, "alert", {
      kind: "alert",
      section: "alerts",
      source: "alerts",
      severity: "error",
    });
    const entries = groupSignals(alerts);
    expect(entries).toHaveLength(13);
    expect(entries.every((entry) => entry.type === "signal")).toBe(true);
  });

  test("a kind outside the allowlist never collapses", () => {
    const entries = groupSignals(many(13, "new", { kind: "brand-new-kind" }));
    expect(entries).toHaveLength(13);
    expect(entries.every((entry) => entry.type === "signal")).toBe(true);
    expect(
      groupSignals(many(5, "proto", { kind: "constructor" })),
    ).toHaveLength(5);
  });

  test("the allowlist is exactly the reviewed kinds", () => {
    expect([...SIGNAL_GROUP_KINDS.keys()].toSorted()).toEqual([
      "renovate-approval",
      "renovate-pr",
      "restore-failure",
      "schedule-paused",
    ]);
    expect(SIGNAL_GROUP_KINDS.has("alert")).toBe(false);
  });

  test("sections are not merged", () => {
    const entries = groupSignals([
      ...many(3, "maintenance", { kind: "schedule-paused" }),
      ...many(3, "delivery", {
        kind: "schedule-paused",
        section: "delivery",
      }),
    ]);
    expect(shape(entries)).toEqual([
      "[3 paused schedules: maintenance-0,maintenance-1,maintenance-2]",
      "[3 paused schedules: delivery-0,delivery-1,delivery-2]",
    ]);
    expect(
      entries.map((entry) => entry.type === "group" && entry.section),
    ).toEqual(["maintenance", "delivery"]);
  });

  test("severity and needsMe split groups", () => {
    const entries = groupSignals([
      ...many(3, "error", { severity: "error" }),
      ...many(3, "warning"),
      ...many(3, "machine", { needsMe: false }),
      ...many(2, "info", { severity: "info" }),
    ]);
    expect(shape(entries)).toEqual([
      "[3 failed Velero restores: error-0,error-1,error-2]",
      "[3 failed Velero restores: warning-0,warning-1,warning-2]",
      "[3 failed Velero restores: machine-0,machine-1,machine-2]",
      "info-0",
      "info-1",
    ]);
    const ids = entries.flatMap((entry) =>
      entry.type === "group" ? [entry.id] : [],
    );
    expect(new Set(ids).size).toBe(3);
  });

  test("a group carries its key, count, severity and oldest since", () => {
    const [group, ...rest] = groupSignals([
      signal("newest", { since: "2026-09-24T10:00:00.000Z" }),
      signal("undated"),
      signal("oldest", { since: "2026-08-01T00:00:00Z" }),
      signal("middle", { since: "2026-09-01T00:00:00.000Z" }),
    ]);
    expect(rest).toEqual([]);
    expect(group).toEqual({
      type: "group",
      id: "group:maintenance:restore-failure:warning:needs-me",
      kind: "restore-failure",
      section: "maintenance",
      label: "4 failed Velero restores",
      severity: "warning",
      needsMe: true,
      count: 4,
      since: "2026-08-01T00:00:00Z",
      signals: [
        expect.objectContaining({ id: "newest" }),
        expect.objectContaining({ id: "undated" }),
        expect.objectContaining({ id: "oldest" }),
        expect.objectContaining({ id: "middle" }),
      ],
    });
  });

  test("a group without any dated member has no since", () => {
    const [group] = groupSignals(many(3, "restore"));
    expect(group).not.toHaveProperty("since");
  });

  test("the group id is stable when membership changes", () => {
    const [before] = groupSignals(many(3, "restore"));
    const [after] = groupSignals(many(9, "other"));
    expect(before?.type).toBe("group");
    expect(after).toMatchObject({ type: "group", count: 9 });
    expect(before?.type === "group" && before.id).toBe(
      after?.type === "group" && after.id,
    );
  });

  test("an entry takes the position of its first member", () => {
    const approvals = many(3, "approval", {
      kind: "renovate-approval",
      section: "delivery",
      source: "renovate",
      severity: "info",
    });
    const [first, second, third] = approvals;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error("expected three approvals");
    }
    const entries = groupSignals([
      signal("alert-a", { kind: "alert" }),
      first,
      signal("pr", { kind: "pull-request" }),
      second,
      signal("alert-b", { kind: "alert" }),
      third,
    ]);
    expect(shape(entries)).toEqual([
      "alert-a",
      "[3 Renovate updates awaiting approval: approval-0,approval-1,approval-2]",
      "pr",
      "alert-b",
    ]);
  });

  test("ranked input stays worst-first", () => {
    const ranked = rankSignals([
      ...many(4, "info", { severity: "info" }),
      signal("page", { kind: "alert", severity: "error" }),
      ...many(4, "warning"),
    ]);
    const rank: Record<Severity, number> = {
      ok: 0,
      info: 1,
      unknown: 2,
      warning: 3,
      error: 4,
    };
    const severities = groupSignals(ranked).map((entry) =>
      entry.type === "signal" ? entry.signal.severity : entry.severity,
    );
    expect(severities).toEqual(["error", "warning", "info"]);
    expect(severities.map((severity) => rank[severity])).toEqual(
      severities.map((severity) => rank[severity]).toSorted((a, b) => b - a),
    );
  });

  test("production volume: 123 signals become 2 groups and 13 rows", () => {
    const approvals = many(100, "approval", {
      kind: "renovate-approval",
      section: "delivery",
      source: "renovate",
      severity: "info",
    });
    const restores = many(10, "restore");
    const alerts = many(13, "alert", {
      kind: "alert",
      section: "alerts",
      source: "alerts",
      severity: "error",
    });
    const input = rankSignals([...approvals, ...restores, ...alerts]);
    const entries = groupSignals(input);

    expect(entries).toHaveLength(15);
    expect(entries.filter((entry) => entry.type === "signal")).toHaveLength(13);
    expect(
      entries.flatMap((entry) => (entry.type === "group" ? [entry.label] : [])),
    ).toEqual([
      "10 failed Velero restores",
      "100 Renovate updates awaiting approval",
    ]);
    // No signal is lost or duplicated, whatever the grouping.
    const flat = flatten(entries);
    expect(flat).toHaveLength(input.length);
    expect(new Set(flat.map((member) => member.id))).toEqual(
      new Set(input.map((member) => member.id)),
    );
  });

  test("an empty list has no entries", () => {
    expect(groupSignals([])).toEqual([]);
  });
});

describe("actionableSignals", () => {
  const generatedAt = new Date("2026-09-24T12:00:00.000Z");
  const snapshot = assembleSnapshot({
    generatedAt,
    sources: SOURCE_IDS.map((source) => ({
      source,
      ok: true,
      observedAt: generatedAt.toISOString(),
      durationMs: 10,
    })),
    signals: [
      signal("approval", {
        kind: "renovate-approval",
        section: "delivery",
        source: "renovate",
        severity: "info",
        needsMe: true,
      }),
      signal("informational", { severity: "info", needsMe: false }),
      signal("healthy", { severity: "ok", needsMe: false }),
      signal("blind-spot", { severity: "unknown", needsMe: false }),
      signal("page", {
        kind: "alert",
        section: "alerts",
        source: "alerts",
        severity: "error",
        needsMe: false,
      }),
      signal("restore", { severity: "warning", needsMe: true }),
    ],
    metrics: [],
  });

  test("is the ranked union of attention severity and needsMe", () => {
    expect(actionableSignals(snapshot).map((entry) => entry.id)).toEqual([
      "page",
      "restore",
      "blind-spot",
      "approval",
    ]);
  });

  test("includes each signal once even when both conditions hold", () => {
    const ids = actionableSignals(snapshot).map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
