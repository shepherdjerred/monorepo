import { describe, expect, test } from "vitest";
import { getScoutRuleGroups } from "./scout.ts";
import { getScoutDurableRuleGroup } from "./scout-durable-rules.ts";

const durable = getScoutDurableRuleGroup();

/**
 * Every metric name these rules may reference.
 *
 * Nothing in this repo cross-checks a rule's PromQL against the metrics the
 * Scout backend actually defines, so a typo would pass every gate and simply
 * never fire. Pinning the names here does not prove the backend emits them, but
 * it does mean a rule cannot quietly drift onto a metric nobody chose — and the
 * list is short enough to check against `metrics/durable-pipeline.ts` by eye.
 */
const DURABLE_METRICS = [
  "scout_durable_backlog_oldest_age_seconds",
  "scout_durable_notification_intents",
  "scout_durable_lake_staging_lag_seconds",
  "scout_durable_receipts_recorded_total",
];

function ruleNamed(alert: string) {
  const rule = durable.rules?.find((candidate) => candidate.alert === alert);
  if (rule === undefined) throw new Error(`Missing ${alert}`);
  return rule;
}

describe("Scout durable pipeline alert rules", () => {
  test("is registered in the Scout rule groups", () => {
    const names = getScoutRuleGroups().map((group) => group.name);
    expect(names).toContain("scout-durable");
  });

  test("covers each question on the V2 acceptance checklist", () => {
    const alerts = new Set(durable.rules?.map((rule) => rule.alert));
    expect(alerts).toEqual(
      new Set([
        "ScoutDurableWorkflowStartStranded",
        "ScoutDurableReceiptConflicts",
        "ScoutDurableUnknownDeliveries",
        "ScoutDurableRecoveryBacklogStale",
        "ScoutDurableLakeStagingLag",
        "ScoutDurableSweepMissing",
      ]),
    );
  });

  test("reads only metrics the durable pipeline defines", () => {
    for (const rule of durable.rules ?? []) {
      const expression = JSON.stringify(rule.expr);
      const referenced = [...expression.matchAll(/scout_durable_[a-z_]+/g)].map(
        (match) => match[0],
      );
      expect(referenced.length).toBeGreaterThan(0);
      for (const metric of referenced) {
        expect(DURABLE_METRICS).toContain(metric);
      }
    }
  });

  test("never scopes to a runtime role", () => {
    // These gauges come from whichever role owns the database sweeps, which
    // differs by stage and is mid-amendment. Naming a role here would make the
    // rule wrong the next time the split moves, and would let the deferred
    // activity-worker role turn into a firing condition.
    for (const rule of durable.rules ?? []) {
      expect(JSON.stringify(rule.expr)).not.toContain("role=");
    }
  });

  test.each([
    "ScoutDurableWorkflowStartStranded",
    "ScoutDurableUnknownDeliveries",
    "ScoutDurableRecoveryBacklogStale",
    "ScoutDurableLakeStagingLag",
    "ScoutDurableSweepMissing",
  ])("%s survives its gauge going away entirely", (alert) => {
    // One role sweeps these gauges. Without an absent() guard, a rollout that
    // stopped that role would turn every threshold rule green at the moment it
    // is needed — silence from a missing sweep looks exactly like an empty
    // backlog.
    const expression = JSON.stringify(ruleNamed(alert).expr);
    expect(expression).toContain("absent(");
    expect(expression).toContain(String.raw`environment=\"beta\"`);
    expect(expression).toContain(String.raw`environment=\"prod\"`);
  });

  test("routes every rule to a severity Alertmanager delivers", () => {
    for (const rule of durable.rules ?? []) {
      // `info` is matched to the null receiver, so an info-severity rule is a
      // rule that silently never reaches anyone.
      expect(["warning", "critical"]).toContain(rule.labels?.["severity"]);
      expect(rule.for).toBeDefined();
      expect(rule.annotations?.["summary"]).toBeDefined();
      expect(rule.annotations?.["message"]).toBeDefined();
    }
  });

  test("counts receipt conflicts over a window rather than as a rate", () => {
    const expression = JSON.stringify(
      ruleNamed("ScoutDurableReceiptConflicts").expr,
    );
    // A conflict is a discrete event that is normally zero. A per-second rate
    // of a handful of them rounds to nothing and never crosses a threshold.
    expect(expression).toContain("increase(");
    expect(expression).not.toContain("rate(scout_durable");
    expect(expression).toContain(String.raw`outcome=\"conflict\"`);
  });

  test("keeps lake staging lag separated by artifact kind", () => {
    const expression = JSON.stringify(
      ruleNamed("ScoutDurableLakeStagingLag").expr,
    );
    // Matches, timelines and prematch payloads stage independently; folding
    // them lets a healthy match flow mask timelines that are days behind.
    expect(expression).toContain("max by (environment, artifact_kind)");
  });

  test("pages on a single unknown delivery rather than on a rate of them", () => {
    const expression = JSON.stringify(
      ruleNamed("ScoutDurableUnknownDeliveries").expr,
    );
    // Nothing may retry one automatically, so each is human work. One is
    // enough to need a person.
    expect(expression).toContain(String.raw`state=\"unknown-delivery\"`);
    expect(expression).toContain("> 0");
  });
});
