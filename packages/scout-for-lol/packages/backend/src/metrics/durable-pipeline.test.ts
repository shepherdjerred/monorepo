import { describe, expect, test } from "vitest";
import {
  NOTIFICATION_INTENT_STATE_KINDS,
  RECOVERY_BATCH_STATE_KINDS,
} from "#src/database/durable/pipeline-scan.ts";
import {
  DURABLE_BACKLOG_FAMILIES,
  scoutDurableBacklogOldestAge,
  scoutDurableLakeStagingLag,
  scoutDurableNotificationIntents,
  scoutDurableReceiptsRecorded,
  scoutDurableWorkflowStartAcceptances,
  scoutDurableRecoveryBatches,
} from "#src/metrics/durable-pipeline.ts";
import { registry } from "#src/metrics/registry.ts";

/**
 * One sample series per metric, with the labels it is allowed to carry.
 *
 * Spelled out here rather than read off the declaration, so that widening a
 * label set has to be a deliberate edit in two places. The rule these enforce
 * is cardinality: every one of these labels draws from a closed vocabulary, and
 * a match id, guild id or intent key on any of them would multiply the series
 * count by the traffic.
 */
const DURABLE_METRICS = [
  {
    name: "scout_durable_notification_intents",
    labels: { state: "pending" },
    fill: () => scoutDurableNotificationIntents.set({ state: "pending" }, 0),
  },
  {
    name: "scout_durable_recovery_batches",
    labels: { state: "planned" },
    fill: () => scoutDurableRecoveryBatches.set({ state: "planned" }, 0),
  },
  {
    name: "scout_durable_backlog_oldest_age_seconds",
    labels: { family: "live-recovery-batches" },
    fill: () =>
      scoutDurableBacklogOldestAge.set({ family: "live-recovery-batches" }, 0),
  },
  {
    name: "scout_durable_lake_staging_lag_seconds",
    labels: { artifact_kind: "match" },
    fill: () => scoutDurableLakeStagingLag.set({ artifact_kind: "match" }, 0),
  },
  {
    name: "scout_durable_receipts_recorded_total",
    labels: { receipt_kind: "lake-staging-match", outcome: "applied" },
    fill: () =>
      scoutDurableReceiptsRecorded.inc(
        { receipt_kind: "lake-staging-match", outcome: "applied" },
        0,
      ),
  },
];

describe("durable pipeline metrics", () => {
  test.each(DURABLE_METRICS)("$name is registered exactly once", ({ name }) => {
    // prom-client throws at import when two modules register one name, which
    // takes the process down at boot rather than at the first inc(). Reading
    // the registry back proves this module is the single home without relying
    // on that crash having been survivable.
    const registered = registry
      .getMetricsAsArray()
      .filter((metric) => metric.name === name);
    expect(registered).toHaveLength(1);
  });

  test.each(DURABLE_METRICS)(
    "$name emits only its bounded labels",
    async ({ name, labels, fill }) => {
      // Asserted on an emitted series rather than on the declaration, because
      // the series is what Prometheus stores and what its cardinality is
      // charged against.
      fill();
      const metric = registry.getSingleMetric(name);
      if (metric === undefined) throw new Error(`Missing ${name}`);
      const emitted = await metric.get();
      const sample = emitted.values.find((value) =>
        Object.entries(labels).every(
          ([key, expected]) => value.labels[key] === expected,
        ),
      );
      if (sample === undefined) throw new Error(`No series for ${name}`);
      expect(Object.keys(sample.labels).toSorted()).toEqual(
        Object.keys(labels).toSorted(),
      );
    },
  );

  test("reports one series per notification intent state", async () => {
    // The gauge has to cover the domain's whole union, because a state with no
    // series reads as a state with no rows. The kinds come from the exhaustive
    // classification table, so this fails the moment the domain gains a state
    // the sweep does not fill.
    expect(NOTIFICATION_INTENT_STATE_KINDS).toEqual([
      "pending",
      "ready",
      "sending",
      "delivered",
      "suppressed",
      "expired",
      "permission-denied",
      "unknown-delivery",
    ]);
    for (const state of NOTIFICATION_INTENT_STATE_KINDS) {
      scoutDurableNotificationIntents.set({ state }, 0);
    }
    const metric = await scoutDurableNotificationIntents.get();
    expect(metric.values).toHaveLength(NOTIFICATION_INTENT_STATE_KINDS.length);
  });

  test("reports one series per recovery batch state", async () => {
    expect(RECOVERY_BATCH_STATE_KINDS).toEqual([
      "planned",
      "scanning",
      "processing",
      "digesting",
      "complete",
      "abandoned",
    ]);
    for (const state of RECOVERY_BATCH_STATE_KINDS) {
      scoutDurableRecoveryBatches.set({ state }, 0);
    }
    const metric = await scoutDurableRecoveryBatches.get();
    expect(metric.values).toHaveLength(RECOVERY_BATCH_STATE_KINDS.length);
  });

  test("names only backlog families whose ordering column is a true age", () => {
    // Stalled notifications are deliberately absent: that read orders by
    // freshness deadline, so its head is the intent closest to EXPIRING rather
    // than the one waiting longest, and publishing that as an age would invert
    // the direction an operator reads it.
    expect(DURABLE_BACKLOG_FAMILIES).toEqual([
      "stalled-match-processing",
      "live-recovery-batches",
      "unaccepted-workflow-starts",
    ]);
  });

  test("separates lake staging lag by artifact kind", async () => {
    for (const artifact of ["match", "timeline", "prematch"]) {
      scoutDurableLakeStagingLag.set({ artifact_kind: artifact }, 0);
    }
    const metric = await scoutDurableLakeStagingLag.get();
    expect(metric.values).toHaveLength(3);
  });

  test("counts a receipt write under its kind and the table's answer", async () => {
    scoutDurableReceiptsRecorded.inc({
      receipt_kind: "v2-match-observation",
      outcome: "applied",
    });
    scoutDurableReceiptsRecorded.inc({
      receipt_kind: "v2-match-observation",
      outcome: "conflict",
    });
    const metric = await scoutDurableReceiptsRecorded.get();
    const conflicts = metric.values.find(
      (value) =>
        value.labels.receipt_kind === "v2-match-observation" &&
        value.labels.outcome === "conflict",
    );
    // `conflict` must stay its own series: it is the only outcome meaning one
    // fact was recorded twice with two different claims about it, which is the
    // duplicate signal the V2 acceptance checklist asks about.
    expect(conflicts?.value).toBe(1);
  });

  test("counts the ordinary handoff answers beside the rare one", async () => {
    // The soak this counter exists for is most likely to read zero on
    // `answered-by-another-run`, and zero has to be trustworthy. Counting the
    // ordinary answers is what makes it so: `applied` climbing is standing
    // proof the instrument is live, so a flat rare series beside it is
    // evidence rather than silence.
    scoutDurableWorkflowStartAcceptances.inc({ outcome: "applied" });
    scoutDurableWorkflowStartAcceptances.inc({
      outcome: "answered-by-another-run",
    });
    const metric = await scoutDurableWorkflowStartAcceptances.get();
    const seriesFor = (outcome: string) =>
      metric.values.find((value) => value.labels.outcome === outcome)?.value;
    expect(seriesFor("applied")).toBe(1);
    expect(seriesFor("answered-by-another-run")).toBe(1);
  });
});
