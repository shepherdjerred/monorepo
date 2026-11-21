import {
  allSignals,
  findMetric,
  findSection,
  needsMeSignals,
} from "@shepherdjerred/ops-model/assemble.ts";
import { METRIC_IDS } from "@shepherdjerred/ops-model/metric-ids.ts";
import {
  OpsIngestSchema,
  SECTION_IDS,
  SnapshotResponseSchema,
  type Signal,
  type Snapshot,
} from "@shepherdjerred/ops-model/snapshot.ts";
import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, test } from "vitest";

import {
  volumeOpsIngest,
  volumeSnapshotResponse,
  type VolumeVariant,
} from "#test-fixtures/ops-snapshot-volume";

const NOW = "2026-11-19T12:00:00Z";
const VARIANTS: readonly VolumeVariant[] = ["per-update", "aggregate"];

function snapshotOf(variant: VolumeVariant): Snapshot {
  return volumeOpsIngest(NOW, variant).snapshot;
}

function ofKind(snapshot: Snapshot, kind: string): Signal[] {
  return allSignals(snapshot).filter((signal) => signal.kind === kind);
}

function signalById(snapshot: Snapshot, id: string): Signal {
  const signal = allSignals(snapshot).find((entry) => entry.id === id);
  if (signal === undefined) throw new Error(`fixture has no signal ${id}`);
  return signal;
}

function hoursOld(signal: Signal): number {
  if (signal.since === undefined) throw new Error(`${signal.id} has no since`);
  return Temporal.Instant.from(NOW)
    .since(Temporal.Instant.from(signal.since))
    .total("hours");
}

describe.each(VARIANTS)("the %s volume fixture", (variant) => {
  const snapshot = snapshotOf(variant);

  test("parses as an ingest body and as a snapshot response", () => {
    expect(() =>
      OpsIngestSchema.parse(volumeOpsIngest(NOW, variant)),
    ).not.toThrow();
    const response = SnapshotResponseSchema.parse(
      volumeSnapshotResponse(NOW, variant),
    );
    expect(response.stale).toBe(false);
    expect(response.sections).toEqual(snapshot.sections);
  });

  test("populates all nine sections from healthy sources", () => {
    expect(snapshot.sections.map((section) => section.id)).toEqual([
      ...SECTION_IDS,
    ]);
    expect(snapshot.sources.every((source) => source.ok)).toBe(true);
    for (const section of snapshot.sections) {
      expect(section.signals.length, section.id).toBeGreaterThan(0);
      expect(section.metrics.length, section.id).toBeGreaterThan(0);
    }
  });

  test("emits every headline metric exactly once", () => {
    const ids = snapshot.sections.flatMap((section) =>
      section.metrics.map((metric) => metric.id),
    );
    expect(ids.toSorted()).toEqual(Object.values(METRIC_IDS).toSorted());
  });

  test("gives every signal a unique id", () => {
    const ids = allSignals(snapshot).map((signal) => signal.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("has thirteen alert groups: one fresh error among old warnings", () => {
    const alerts = ofKind(snapshot, "alert");
    expect(alerts).toHaveLength(13);
    expect(findSection(snapshot, "alerts").signals).toEqual(alerts);
    const errors = alerts.filter((signal) => signal.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors.map((signal) => Math.round(hoursOld(signal) * 60))).toEqual([
      15,
    ]);
    const warnings = alerts.filter((signal) => signal.severity === "warning");
    expect(warnings).toHaveLength(12);
    for (const warning of warnings) {
      expect(hoursOld(warning)).toBeGreaterThanOrEqual(24);
      expect(hoursOld(warning)).toBeLessThanOrEqual(7 * 24);
    }
    const repeated = alerts.filter((signal) => signal.title.endsWith("(×3)"));
    expect(repeated.map((signal) => signal.attributes["count"])).toEqual([3]);
    const alertsSection = findSection(snapshot, "alerts");
    expect(findMetric(alertsSection, METRIC_IDS.alertsCritical)).toMatchObject({
      value: 1,
      severity: "error",
    });
    expect(findMetric(alertsSection, METRIC_IDS.alertsWarning)).toMatchObject({
      value: 14,
      severity: "warning",
    });
  });

  test("has fourteen quota windows and the AI spend signals", () => {
    expect(ofKind(snapshot, "quota-window")).toHaveLength(14);
    expect(ofKind(snapshot, "tool-usage")).toHaveLength(5);
    expect(ofKind(snapshot, "budget")).toHaveLength(1);
    expect(ofKind(snapshot, "provider-cost")).toHaveLength(1);
    const exhausted = signalById(snapshot, "ai:quota:claude-code:five-hour");
    expect(exhausted.attributes["usedRatio"]).toBe(1);
    const resetsAt = Temporal.Instant.from(
      String(exhausted.attributes["resetsAt"]),
    );
    expect(Temporal.Instant.compare(resetsAt, Temporal.Instant.from(NOW))).toBe(
      -1,
    );
  });

  test("has ten Velero restore failures, 30 to 42 days old", () => {
    const restores = allSignals(snapshot).filter((signal) =>
      signal.id.startsWith("maintenance:velero-restore:velero:"),
    );
    expect(restores).toHaveLength(10);
    for (const restore of restores) {
      expect(restore).toMatchObject({ severity: "warning", needsMe: true });
      expect(hoursOld(restore) / 24).toBeGreaterThanOrEqual(30);
      expect(hoursOld(restore) / 24).toBeLessThanOrEqual(42);
    }
  });

  test("uses the collector's kinds for the remaining sections", () => {
    expect(ofKind(snapshot, "pull-request")).toHaveLength(9);
    expect(
      ofKind(snapshot, "pull-request").filter((signal) => signal.needsMe),
    ).toHaveLength(2);
    expect(ofKind(snapshot, "schedule-paused")).toHaveLength(16);
    expect(ofKind(snapshot, "triage-issue").length).toBeGreaterThan(0);
    expect(ofKind(snapshot, "error-issue").length).toBeGreaterThan(0);
    expect(signalById(snapshot, "ci:main").kind).toBe("ci-branch");
    expect(signalById(snapshot, "renovate:pending-checks").kind).toBe(
      "renovate-pending",
    );
  });
});

describe("the per-update volume fixture", () => {
  const snapshot = snapshotOf("per-update");

  test("has one signal per Renovate update and pull request", () => {
    const approvals = ofKind(snapshot, "renovate-approval");
    expect(approvals).toHaveLength(100);
    for (const approval of approvals) {
      expect(approval).toMatchObject({ severity: "info", needsMe: true });
      expect(approval.id).toBe(
        `renovate:approve:${String(approval.attributes["branch"])}`,
      );
      expect(approval.title).toMatch(/^chore\(deps\): update .+ to v\d/u);
    }
    const pullRequests = ofKind(snapshot, "renovate-pr");
    expect(pullRequests).toHaveLength(12);
    expect(
      pullRequests.filter((signal) => signal.severity === "warning"),
    ).toHaveLength(2);
  });

  test("leaves well over a hundred signals waiting on Jerred", () => {
    expect(needsMeSignals(snapshot).length).toBeGreaterThanOrEqual(110);
    expect(
      findSection(snapshot, "delivery").signals.length,
    ).toBeGreaterThanOrEqual(110);
  });

  test("reproduces today's collector defects", () => {
    expect(
      findMetric(findSection(snapshot, "alerts"), METRIC_IDS.alertsFiring),
    ).toMatchObject({ value: 15, severity: "ok" });
    expect(ofKind(snapshot, "backup-failure")).toHaveLength(10);
    expect(
      signalById(snapshot, "ai:quota:claude-code:five-hour"),
    ).toMatchObject({
      severity: "error",
      title: "claude-code rolling: 100% used",
    });
    expect(
      signalById(snapshot, "ai:quota:antigravity:antigravity-claude-5h")
        .severity,
    ).toBe("warning");
    expect(
      findMetric(findSection(snapshot, "ai"), METRIC_IDS.aiQuotaMaxUsedRatio),
    ).toMatchObject({ value: 1, severity: "error" });
  });
});

describe("the aggregate volume fixture", () => {
  const snapshot = snapshotOf("aggregate");

  test("groups the Renovate approvals and healthy pull requests", () => {
    expect(ofKind(snapshot, "renovate-approval")).toHaveLength(1);
    const approvals = signalById(snapshot, "renovate:awaiting-approval");
    expect(approvals).toMatchObject({
      kind: "renovate-approval",
      severity: "info",
      needsMe: true,
      title: "100 Renovate updates awaiting approval",
      attributes: { count: 100 },
    });
    expect(approvals.attributes).toEqual({ count: 100 });
    // Every title joined with "; ", cut to the collector's 500-unit budget.
    expect(approvals.detail).toHaveLength(500);
    expect(approvals.detail).toMatch(
      /^chore\(deps\): update dependency react to v2; .+…$/u,
    );
    const openPullRequests = signalById(snapshot, "renovate:open-prs");
    expect(openPullRequests).toMatchObject({
      kind: "renovate-open-prs",
      severity: "info",
      needsMe: false,
      title: "10 Renovate pull requests open",
      attributes: { count: 10 },
    });
    expect(openPullRequests.detail).toBeUndefined();
    const healthyAges = ofKind(snapshotOf("per-update"), "renovate-pr")
      .filter((signal) => signal.severity === "info")
      .map((signal) => hoursOld(signal));
    expect(hoursOld(openPullRequests)).toBe(Math.max(...healthyAges));
    const failing = ofKind(snapshot, "renovate-pr");
    expect(failing).toHaveLength(2);
    expect(failing.every((signal) => signal.severity === "warning")).toBe(true);
  });

  test("leaves fewer than thirty signals waiting on Jerred", () => {
    expect(needsMeSignals(snapshot).length).toBeLessThan(30);
  });

  test("carries the corrected alert, restore and quota signals", () => {
    expect(
      findMetric(findSection(snapshot, "alerts"), METRIC_IDS.alertsFiring),
    ).toMatchObject({ value: 15, severity: "error" });
    const restores = ofKind(snapshot, "restore-failure");
    expect(restores).toHaveLength(10);
    expect(
      restores.every(
        (signal) => signal.attributes["phase"] === "PartiallyFailed",
      ),
    ).toBe(true);
    expect(ofKind(snapshot, "backup-failure")).toHaveLength(0);
    expect(
      signalById(snapshot, "ai:quota:claude-code:five-hour"),
    ).toMatchObject({
      severity: "info",
      title: "claude-code rolling: reset since last reading (was 100%)",
    });
    // A window that resets within six hours is capped at info, title unchanged.
    expect(
      signalById(snapshot, "ai:quota:antigravity:antigravity-claude-5h"),
    ).toMatchObject({
      severity: "info",
      title: "antigravity modelScoped: 91% used",
    });
    expect(
      findMetric(findSection(snapshot, "ai"), METRIC_IDS.aiQuotaMaxUsedRatio),
    ).toMatchObject({ value: 0.97, severity: "error" });
  });

  test("keeps the same signal ids for the unchanged signals", () => {
    const perUpdate = new Set(
      allSignals(snapshotOf("per-update")).map((signal) => signal.id),
    );
    const added = allSignals(snapshot)
      .map((signal) => signal.id)
      .filter((id) => !perUpdate.has(id));
    expect(added.toSorted()).toEqual([
      "renovate:awaiting-approval",
      "renovate:open-prs",
    ]);
  });
});
