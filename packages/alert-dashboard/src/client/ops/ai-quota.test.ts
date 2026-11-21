import { Temporal } from "@js-temporal/polyfill";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import type { Signal } from "@shepherdjerred/ops-model/snapshot.ts";
import { describe, expect, it } from "vitest";

import { hasReset, quotaTable, resetsText, usedText } from "./ai-quota.ts";

const GENERATED_AT = "2026-11-20T12:00:00Z";
const NOW = Temporal.Instant.from("2026-11-20T12:02:00Z");

function quota(
  provider: string,
  windowId: string,
  options: {
    readonly windowKind?: string;
    readonly usedRatio?: number;
    readonly severity?: Severity;
    readonly resetsAt?: string;
  } = {},
): Signal {
  return {
    id: `ai:quota:${provider}:${windowId}`,
    source: "ai",
    section: "ai",
    kind: "quota-window",
    severity: options.severity ?? "ok",
    needsMe: false,
    title: `${provider} ${windowId}`,
    attributes: {
      provider,
      windowId,
      windowKind: options.windowKind ?? "rolling",
      usedRatio: options.usedRatio ?? 0.5,
      ...(options.resetsAt === undefined ? {} : { resetsAt: options.resetsAt }),
    },
    links: [],
  };
}

describe("hasReset", () => {
  it("is true once the reset time is at or before the snapshot", () => {
    expect(hasReset("2026-11-20T11:57:00Z", GENERATED_AT)).toBe(true);
    expect(hasReset(GENERATED_AT, GENERATED_AT)).toBe(true);
  });

  it("is false while the reset is ahead of the snapshot", () => {
    expect(hasReset("2026-11-20T12:00:01Z", GENERATED_AT)).toBe(false);
  });

  it("is false when the window reports no reset time", () => {
    expect(hasReset(undefined, GENERATED_AT)).toBe(false);
  });

  it("compares instants, not strings, across offsets", () => {
    // 13:30+02:00 is 11:30Z, half an hour before the snapshot.
    expect(hasReset("2026-11-20T13:30:00+02:00", GENERATED_AT)).toBe(true);
  });
});

describe("usedText", () => {
  it("is the percentage of a live window", () => {
    expect(usedText({ usedRatio: 0.836, reset: false })).toBe("84%");
  });

  it("marks the last reading of a window that has reset", () => {
    expect(usedText({ usedRatio: 1, reset: true })).toBe("reset · was 100%");
  });
});

describe("resetsText", () => {
  it.each([
    ["2026-11-20T12:44:00Z", "resets in 42m"],
    ["2026-11-20T12:02:10Z", "resets in 1m"],
    ["2026-11-20T17:02:00Z", "resets in 5h"],
    ["2026-11-22T11:02:00Z", "resets in 47h"],
    ["2026-11-23T12:02:00Z", "resets in 3d"],
  ])("counts down to %s as %s", (resetsAt, text) => {
    expect(resetsText({ resetsAt, reset: false }, NOW)).toBe(text);
  });

  it("awaits a new reading once the window has reset", () => {
    expect(
      resetsText({ resetsAt: "2026-11-20T11:57:00Z", reset: true }, NOW),
    ).toBe("awaiting new reading");
  });

  it("says a window is resetting when its time passed after the snapshot", () => {
    expect(
      resetsText({ resetsAt: "2026-11-20T12:01:00Z", reset: false }, NOW),
    ).toBe("resetting now");
  });

  it("says so when the window reports no reset time", () => {
    expect(resetsText({ resetsAt: undefined, reset: false }, NOW)).toBe(
      "reset time unknown",
    );
  });
});

describe("quotaTable", () => {
  it("groups by provider display name and sorts windows by id", () => {
    const table = quotaTable(
      [
        quota("muse", "weekly", { windowKind: "weekly" }),
        quota("claude-code", "weekly", { windowKind: "weekly" }),
        quota("antigravity", "weekly", { windowKind: "weekly" }),
        quota("claude-code", "five-hour"),
        quota("zeta-new", "daily", { windowKind: "daily" }),
      ],
      GENERATED_AT,
    );
    expect(
      table.groups.map((group) => [
        group.label,
        group.rows.map((row) => row.label),
      ]),
    ).toEqual([
      ["Antigravity", ["Weekly"]],
      ["Claude Code", ["5-hour", "Weekly"]],
      ["Muse", ["Weekly"]],
      ["Zeta New", ["Daily"]],
    ]);
    expect(table.invalid).toEqual([]);
  });

  it("takes each row's severity from its signal, not from the ratio", () => {
    const table = quotaTable(
      [
        quota("codex", "a", { usedRatio: 0.99, severity: "info" }),
        quota("codex", "b", { usedRatio: 0.1, severity: "error" }),
        quota("codex", "c", { usedRatio: 0.9, severity: "unknown" }),
      ],
      GENERATED_AT,
    );
    expect(table.groups[0]?.rows.map((row) => row.severity)).toEqual([
      "info",
      "error",
      "unknown",
    ]);
  });

  it("marks the windows whose reset has passed", () => {
    const table = quotaTable(
      [
        quota("kimi", "a", { resetsAt: "2026-11-20T11:57:00Z" }),
        quota("kimi", "b", { resetsAt: "2026-11-20T13:12:00Z" }),
        quota("kimi", "c"),
      ],
      GENERATED_AT,
    );
    expect(table.groups[0]?.rows.map((row) => row.reset)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("flags windows of one provider that share a label", () => {
    const table = quotaTable(
      [
        quota("codex", "codex-window", { windowKind: "rolling" }),
        quota("codex", "window", { windowKind: "rolling" }),
        quota("codex", "weekly", { windowKind: "weekly" }),
        quota("muse", "window", { windowKind: "rolling" }),
      ],
      GENERATED_AT,
    );
    expect(
      table.groups.flatMap((group) =>
        group.rows.map((row) => [row.id, row.label, row.ambiguous]),
      ),
    ).toEqual([
      ["ai:quota:codex:codex-window", "Rolling window", true],
      ["ai:quota:codex:weekly", "Weekly", false],
      ["ai:quota:codex:window", "Rolling window", true],
      ["ai:quota:muse:window", "Rolling window", false],
    ]);
  });

  it("keeps a signal with incomplete attributes instead of dropping it", () => {
    const broken: Signal = {
      ...quota("codex", "weekly"),
      id: "ai:quota:codex:broken",
      attributes: { provider: "codex", usedRatio: 0.4 },
    };
    const negative = quota("codex", "negative", { usedRatio: -0.1 });
    const table = quotaTable(
      [negative, quota("codex", "weekly"), broken],
      GENERATED_AT,
    );
    expect(table.invalid.map((signal) => signal.id)).toEqual([
      "ai:quota:codex:broken",
      "ai:quota:codex:negative",
    ]);
    expect(table.groups.flatMap((group) => group.rows)).toHaveLength(1);
  });
});
