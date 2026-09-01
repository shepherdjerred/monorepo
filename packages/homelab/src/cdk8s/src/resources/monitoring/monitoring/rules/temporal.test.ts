import { describe, expect, test } from "vitest";
import { getTemporalRuleGroups } from "./temporal.ts";
import { TEMPORAL_DOMAIN_QUEUES } from "./temporal-worker-health.ts";

function findFailureRule(alertName: string): string {
  const failureGroup = getTemporalRuleGroups().find(
    (group) => group.name === "temporal-workflow-failures",
  );
  if (failureGroup?.rules === undefined) {
    throw new Error("Missing temporal-workflow-failures rule group");
  }
  const rule = failureGroup.rules.find((r) => r.alert === alertName);
  if (rule === undefined) {
    throw new Error(`Missing ${alertName} rule`);
  }
  const expression = rule.expr.value;
  if (typeof expression !== "string") {
    throw new TypeError(`Expected ${alertName} rule expression to be a string`);
  }
  return expression;
}

describe("Temporal workflow outcome rules", () => {
  test("alerts on schedule delay, Workflow Task failures, nondeterminism, and exhausted Activity retries", () => {
    const healthGroup = getTemporalRuleGroups().find(
      (group) => group.name === "temporal-platform-health",
    );
    if (healthGroup?.rules === undefined) {
      throw new Error("Missing temporal-platform-health rule group");
    }
    const expressions = new Map(
      healthGroup.rules.map((rule) => [rule.alert, rule.expr.value]),
    );
    expect(expressions.get("TemporalScheduleActionDelayed")).toContain(
      "schedule_action_delay_bucket",
    );
    expect(expressions.get("TemporalWorkflowTaskFailing")).toContain(
      "temporal_worker_workflow_task_execution_failed",
    );
    expect(expressions.get("TemporalWorkflowNondeterministic")).toContain(
      'failure_reason="NonDeterminismError"',
    );
    // activity_task_fail, not activity_fail — the metric every other
    // Temporal/Scout failure rule in this file queries. It comes from the
    // server, so `namespace` is the Kubernetes namespace and the Temporal
    // namespace is `exported_namespace`; selecting namespace="default"
    // matched nothing and the alert could never fire.
    expect(expressions.get("TemporalActivityRetriesExhausted")).toContain(
      "activity_task_fail",
    );
    expect(expressions.get("TemporalActivityRetriesExhausted")).toContain(
      'exported_namespace=~"prod|beta"',
    );
    expect(expressions.get("TemporalActivityRetriesExhausted")).not.toContain(
      'namespace="default"',
    );
    // The retired drain namespace is empty, so watching it is watching nothing.
    for (const alert of [
      "TemporalWorkflowTaskFailing",
      "TemporalWorkflowNondeterministic",
    ]) {
      expect(expressions.get(alert), alert).toContain(
        'exported_namespace=~"prod|beta"',
      );
    }
    // Tasks aging on a queue nobody polls — the shape of the outage every
    // other rule missed, because pollers were healthy the whole time.
    const stalled = expressions.get("TemporalWorkflowPlaneStalled");
    expect(stalled).toContain("approximate_backlog_age_seconds");
    expect(stalled).toContain('exported_namespace=~"prod|beta"');
    expect(stalled).toContain("> 900");
    // Age, not count: tombstoned tasks hold a non-zero count at age zero.
    expect(stalled).not.toContain("approximate_backlog_count");
  });

  test("excludes intentional warm-morning preheat skips", () => {
    const outcomeGroup = getTemporalRuleGroups().find(
      (group) => group.name === "temporal-workflow-outcomes",
    );
    if (outcomeGroup?.rules === undefined) {
      throw new Error("Missing temporal-workflow-outcomes rule group");
    }

    const preheatRule = outcomeGroup.rules.find((rule) => {
      const expression = rule.expr.value;
      return (
        typeof expression === "string" &&
        expression.includes('workflow="goodMorningPreheat"')
      );
    });
    if (preheatRule === undefined) {
      throw new Error("Missing goodMorningPreheat outcome rule");
    }

    const expression = preheatRule.expr.value;
    if (typeof expression !== "string") {
      throw new TypeError(
        "Expected goodMorningPreheat rule expression to be a string",
      );
    }

    expect(expression).toContain('reason!~"no-one-home|not-cold"');
  });

  test("alerts on every domain queue's pollers, backlog, latency, scrape, and readiness", () => {
    const failuresGroup = getTemporalRuleGroups().find(
      (group) => group.name === "temporal-workflow-failures",
    );
    if (failuresGroup?.rules === undefined) {
      throw new Error("Missing temporal-workflow-failures rule group");
    }

    const healthAlerts = [
      "TemporalDomainWorkflowPollerUnavailable",
      "TemporalDomainQueueBacklog",
      "TemporalDomainScheduleToStartHigh",
      "TemporalDomainWorkerScrapeDown",
      "TemporalDomainWorkerPodNotReady",
    ];
    for (const alert of healthAlerts) {
      const rules = failuresGroup.rules.filter((rule) => rule.alert === alert);
      expect(rules, alert).toHaveLength(TEMPORAL_DOMAIN_QUEUES.length);
      expect(
        rules
          .map((rule) => rule.labels?.["task_queue"])
          .toSorted((left, right) => (left ?? "").localeCompare(right ?? "")),
      ).toEqual(
        TEMPORAL_DOMAIN_QUEUES.map((definition) => definition.queue).toSorted(
          (left, right) => left.localeCompare(right),
        ),
      );
    }

    const activityRules = failuresGroup.rules.filter(
      (rule) => rule.alert === "TemporalDomainActivityPollerUnavailable",
    );
    expect(activityRules).toHaveLength(
      TEMPORAL_DOMAIN_QUEUES.filter((definition) => definition.activityPoller)
        .length,
    );
    expect(
      activityRules.map((rule) => rule.labels?.["task_queue"]),
    ).not.toContain("monorepo-workflows");

    const backlogExpressions = failuresGroup.rules
      .filter((rule) => rule.alert === "TemporalDomainQueueBacklog")
      .map((rule) => rule.expr.value);
    expect(
      backlogExpressions.every(
        (expression) =>
          typeof expression === "string" &&
          expression.includes("approximate_backlog_count"),
      ),
    ).toBe(true);
    // The Temporal server sanitizes its metric tag values, so a hyphenated
    // queue is published as `repo_automation` / `monorepo_workflows`. These
    // assertions were previously inverted, which pinned a selector that
    // matched no series: the backlog rule was silent for all seven hyphenated
    // queues, including monorepo-workflows, throughout a fifteen-hour outage.
    expect(backlogExpressions).toContain(
      'max(approximate_backlog_count{namespace="temporal",taskqueue="repo_automation",task_type=~"Workflow|Activity"}) > 0',
    );
    expect(backlogExpressions).toContain(
      'max(approximate_backlog_count{namespace="temporal",taskqueue="monorepo_workflows",task_type=~"Workflow"}) > 0',
    );
    expect(backlogExpressions.join("\n")).not.toContain(
      'taskqueue="repo-automation"',
    );
    expect(backlogExpressions.join("\n")).not.toContain(
      'taskqueue="monorepo-workflows"',
    );

    const workerMetricsDown = failuresGroup.rules.find(
      (rule) => rule.alert === "TemporalWorkerMetricsDown",
    );
    if (workerMetricsDown === undefined) {
      throw new Error("Missing TemporalWorkerMetricsDown alert");
    }
    expect(workerMetricsDown.for).toBe("5m");
    expect(workerMetricsDown.expr.value).toContain("absent(up{");
    expect(workerMetricsDown.expr.value).toContain('service=~".*temporal-');

    const workflowPollerExpressions = failuresGroup.rules
      .filter(
        (rule) => rule.alert === "TemporalDomainWorkflowPollerUnavailable",
      )
      .map((rule) => rule.expr.value);
    // The threshold is the served-namespace count, so retiring the `default`
    // drain has to move both together: one namespace served, one required.
    // Changing the env without the rule would leave this at < 2 and fire on
    // every queue the moment the workers rolled.
    expect(workflowPollerExpressions).toContain(
      'count(sum by (exported_namespace) (temporal_worker_num_pollers{namespace="buildkite",exported_namespace=~"prod",task_queue="maintenance",poller_type="workflow_task"})) < 1',
    );
    expect(workflowPollerExpressions.join("\n")).not.toContain(
      'exported_namespace=~"prod|default"',
    );
    const scoutBetaExpression = workflowPollerExpressions.find(
      (expression) =>
        typeof expression === "string" &&
        expression.includes('task_queue="scout-beta"'),
    );
    // Scout's workflow workers run in their own stage namespace, so the
    // scraped `namespace` label is scout-beta rather than temporal. These
    // rules only render once the pinned Scout workflow images are capable.
    if (scoutBetaExpression !== undefined) {
      expect(scoutBetaExpression).toBe(
        'count(sum by (exported_namespace) (temporal_worker_num_pollers{namespace="scout-beta",exported_namespace=~"beta",task_queue="scout-beta",poller_type="workflow_task"})) < 1',
      );
    }

    const reportHeartbeat = failuresGroup.rules.find(
      (rule) => rule.alert === "TemporalReportHeartbeatStale",
    );
    if (reportHeartbeat === undefined) {
      throw new Error("Missing TemporalReportHeartbeatStale alert");
    }
    expect(reportHeartbeat.expr.value).toContain(
      "temporal_report_freshness_state < 1",
    );
    expect(reportHeartbeat.for).toBe("15m");
  });

  test("does not emit the removed aggregate agent-task timeout alerts", () => {
    const alerts = getTemporalRuleGroups()
      .flatMap((group) => group.rules ?? [])
      .map((rule) => rule.alert);
    expect(alerts).not.toContain("TemporalAgentTaskTimingOut");
    expect(alerts).not.toContain("TemporalAgentTaskTimeoutScanFailed");
  });

  test("guards default against new workflow starts while permitting drain polling", () => {
    const expression = findFailureRule(
      "TemporalDefaultNamespaceStartAttempted",
    );
    expect(expression).toContain('exported_namespace="default"');
    expect(expression).toContain("StartWorkflowExecution");
    expect(expression).toContain("SignalWithStartWorkflowExecution");
    expect(expression).not.toContain("poll");
  });
});

describe("Scout Data Dragon failure rules", () => {
  test("ScoutDataDragonAutoMergeFailed alerts on the last-failure recency gauge", () => {
    const expression = findFailureRule("ScoutDataDragonAutoMergeFailed");
    // Recency gauge + age-out window, so the alert fires on the first failure
    // AND clears 24h later — a bare counter can't do both (increase() misses the
    // first born-at-1 failure; max_over_time(counter) never ages out).
    //
    // The `_s` suffix is required: the gauge has unit "s" and the worker's
    // exporter runs with unitSuffix:true, so the exported series is
    // `..._timestamp_s`. Querying the bare name matched nothing and the alert
    // never fired — this asserts the suffixed name so the regression can't recur.
    expect(expression).toContain(
      "scout_data_dragon_auto_merge_last_failure_timestamp_s",
    );
    expect(expression).not.toContain(
      "scout_data_dragon_auto_merge_last_failure_timestamp[",
    );
    expect(expression).toContain("time() -");
    expect(expression).toContain("60 * 60 * 24");
    // Read through a 24h max_over_time range, not a bare instant vector, so a
    // single-replica worker restart doesn't stale the series and wrongly clear
    // the alert.
    expect(expression).toContain(
      "max_over_time(scout_data_dragon_auto_merge_last_failure_timestamp_s[24h])",
    );
    expect(expression).not.toContain("increase(");
  });

  test("ScoutDataDragonPrAutomationFailed no longer references the unreachable pr-merge-failed reason", () => {
    const expression = findFailureRule("ScoutDataDragonPrAutomationFailed");
    expect(expression).not.toContain("pr-merge-failed");
    expect(expression).toContain("git-push-failed|pr-create-failed");
  });
});
