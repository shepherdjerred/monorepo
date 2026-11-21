import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "#shared/hub/hub-contract.ts";
import { isProblemAction } from "#shared/hub/hub-contract.ts";
import { foldActivity } from "./activity-fold.ts";
import { actionLabel } from "./activity-labels.ts";

let sequence = 0;
function entry(action: string, actor = "ci", entityId = "build-1") {
  sequence += 1;
  return {
    id: `audit-${String(sequence)}`,
    actor,
    action,
    entityId,
    requestId: `request-${String(sequence)}`,
    metadata: {},
    occurredAt: new Date(Date.UTC(2026, 10, 20, 9, 0, 0)).toISOString(),
    target: null,
  } satisfies ActivityEntry;
}

/** Each folded row as its kind and how many entries it holds. */
function shape(entries: ActivityEntry[]) {
  return foldActivity(entries).map((row) =>
    row.kind === "entry"
      ? row.entry.action
      : `${row.kind}:${row.entries[0].action}×${String(row.entries.length)}`,
  );
}

describe("actionLabel", () => {
  it("says what a known action means and shows an unknown one as recorded", () => {
    expect(actionLabel("build.source_recorded")).toBe("Commit recorded");
    expect(actionLabel("worker.recovery_failed")).toBe(
      "Worker recovery failed",
    );
    expect(actionLabel("deployment.lease_renewed")).toBe("Executor checked in");
    expect(actionLabel("snapshot.imported")).toBe("snapshot.imported");
  });
});

describe("folding repeated build records", () => {
  it("folds consecutive commit, verified or published build records by one actor into one counted row", () => {
    expect(
      shape([
        entry("build.verified"),
        entry("build.verified", "ci", "build-2"),
        entry("build.verified", "ci", "build-3"),
        entry("build.published", "ci", "build-3"),
        entry("build.published", "ci", "build-4"),
        entry("build.source_recorded"),
        entry("build.source_recorded", "ci", "build-5"),
        entry("deployment.claimed", "executor", "deployment-1"),
      ]),
    ).toEqual([
      "repeated:build.verified×3",
      "repeated:build.published×2",
      "repeated:build.source_recorded×2",
      "deployment.claimed",
    ]);
  });

  it("ends a run at another actor or another action", () => {
    expect(
      shape([
        entry("build.verified"),
        entry("build.verified", "operator@example.com"),
        entry("deployment.claimed", "executor", "deployment-1"),
        entry("build.verified"),
      ]),
    ).toEqual([
      "repeated:build.verified×1",
      "repeated:build.verified×1",
      "deployment.claimed",
      "repeated:build.verified×1",
    ]);
  });
});

describe("isProblemAction", () => {
  it("marks failures, refusals, lapses and alarms", () => {
    for (const action of [
      "deployment.failed",
      "worker.recovery_failed",
      "deployment.recovery_required",
      "deployment.admission_rejected",
      "deployment.lease_expired",
      "monitor.alarmed",
      "build.incompatible",
    ])
      expect(isProblemAction(action)).toBe(true);
    for (const action of [
      "build.published",
      "deployment.lease_renewed",
      "deployment.reject",
      "deployment.succeeded",
    ])
      expect(isProblemAction(action)).toBe(false);
  });
});
