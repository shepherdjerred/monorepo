import { describe, expect, test } from "vitest";
import { runPromtoolFixture } from "./promtool-fixture.ts";
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

const DURATION_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

function parseDuration(value: string): number {
  const match = /^(?<amount>\d+)(?<unit>[smhd])$/u.exec(value);
  const amount = match?.groups?.["amount"];
  const unit = match?.groups?.["unit"];
  if (amount === undefined || unit === undefined) {
    throw new Error(`Unsupported Prometheus duration: ${value}`);
  }
  const multiplier = DURATION_MS[unit];
  if (multiplier === undefined) {
    throw new Error(`Unsupported Prometheus duration unit: ${value}`);
  }
  return Number(amount) * multiplier;
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
    // Every worker exports counters with `countersTotalSuffix`, so the rule
    // must match the `_total` spelling or it can never fire.
    for (const alert of [
      "TemporalWorkflowTaskFailing",
      "TemporalWorkflowNondeterministic",
    ]) {
      expect(expressions.get(alert), alert).toContain(
        '__name__=~"temporal_worker_workflow_task_execution_failed(_total)?"',
      );
    }
    expect(expressions.get("TemporalWorkflowNondeterministic")).toBe(
      'sum by (exported_namespace, task_queue, workflow_type) (increase({__name__=~"temporal_worker_workflow_task_execution_failed(_total)?",exported_namespace=~"prod|beta",failure_reason="NonDeterminismError"}[30m])) > 0 or sum by (exported_namespace, task_queue, workflow_type) (increase(service_errors_nondeterministic[30m])) > 0',
    );
    // activity_fail counts only failures that will not be retried;
    // activity_task_fail counts every attempt. It comes from the server, so
    // `namespace` is the Kubernetes namespace and the Temporal namespace is
    // `exported_namespace`.
    expect(expressions.get("TemporalActivityRetriesExhausted")).toContain(
      "increase(activity_fail{",
    );
    expect(expressions.get("TemporalActivityRetriesExhausted")).not.toContain(
      "activity_task_fail",
    );
    expect(expressions.get("TemporalActivityRetriesExhausted")).toContain(
      'exported_namespace=~"prod|beta"',
    );
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
          .toSorted((left = "", right = "") => left.localeCompare(right)),
      ).toEqual(
        TEMPORAL_DOMAIN_QUEUES.map((definition) => definition.queue).toSorted(
          (left, right) => left.localeCompare(right),
        ),
      );
    }

    const workflowRules = failuresGroup.rules.filter(
      (rule) => rule.alert === "TemporalDomainWorkflowPollerUnavailable",
    );
    expect(workflowRules).toHaveLength(
      TEMPORAL_DOMAIN_QUEUES.filter(
        (definition) => definition.workflowPoller !== false,
      ).length,
    );
    expect(
      workflowRules.map((rule) => rule.labels?.["task_queue"]),
    ).not.toContain("ops");

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
    // The threshold is the served-namespace count: one namespace served, one
    // required for this production-only queue.
    expect(workflowPollerExpressions).toContain(
      'count(sum by (exported_namespace) (temporal_worker_num_pollers{namespace="woodpecker-ci",exported_namespace=~"prod",task_queue="maintenance",poller_type="workflow_task"})) < 1',
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

  test("alerts on workflow starts outside the active namespaces", () => {
    const expression = findFailureRule(
      "TemporalUnexpectedNamespaceStartAttempted",
    );
    expect(expression).toContain(
      'exported_namespace!~"beta|prod|temporal-system"',
    );
    expect(expression).toContain("StartWorkflowExecution");
    expect(expression).toContain("SignalWithStartWorkflowExecution");
    expect(expression).not.toContain("poll");
  });
});

describe("TemporalWorkflowTasksFailing", () => {
  test("excludes benign UnhandledCommand retries", () => {
    expect(findFailureRule("TemporalWorkflowTasksFailing")).toBe(
      'increase(failed_workflow_tasks{exported_namespace=~"prod|beta",failure!="UnhandledCommand"}[1h]) > 0',
    );
  });
});

describe("Temporal domain poller scoping", () => {
  test("scopes the scout queue's workflow and activity pollers separately", () => {
    // `scout` takes activity tasks in beta but runs its workflows on
    // beta/monorepo-workflows, so no workflow poller belongs on beta/scout.
    // Driving both rules from one namespace list left the workflow rule
    // permanently short by one and firing continuously, which is how a poller
    // alert comes to mean nothing.
    const rules =
      getTemporalRuleGroups().find(
        (group) => group.name === "temporal-workflow-failures",
      )?.rules ?? [];
    const expressionsFor = (alert: string, queue: string): string[] =>
      rules
        .filter((rule) => rule.alert === alert)
        .flatMap((rule) => {
          const expression: unknown = rule.expr.value;
          return typeof expression === "string" &&
            expression.includes(`task_queue="${queue}"`)
            ? [expression]
            : [];
        });

    expect(
      expressionsFor("TemporalDomainWorkflowPollerUnavailable", "scout"),
    ).toEqual([
      'count(sum by (exported_namespace) (temporal_worker_num_pollers{namespace="temporal",exported_namespace=~"prod",task_queue="scout",poller_type="workflow_task"})) < 1',
    ]);
    expect(
      expressionsFor("TemporalDomainActivityPollerUnavailable", "scout")[0],
    ).toContain('exported_namespace=~"prod|beta"');
    expect(
      expressionsFor(
        "TemporalDomainActivityPollerUnavailable",
        "maintenance",
      )[0],
    ).toBe(
      '(count((sum by (exported_namespace) (temporal_worker_num_pollers{namespace="woodpecker-ci",exported_namespace=~"prod",task_queue="maintenance",poller_type="activity_task"}) > 0) or (sum by (exported_namespace) (temporal_worker_worker_task_slots_used{namespace="woodpecker-ci",exported_namespace=~"prod",task_queue="maintenance",worker_type="ActivityWorker"}) > 0)) or vector(0)) < 1',
    );
  });

  test("treats single-slot activity execution and routine Glitter thread additions as healthy", async () => {
    const groups = getTemporalRuleGroups();
    const healthExpr = groups
      .find((group) => group.name === "temporal-platform-health")
      ?.rules?.find((rule) => rule.alert === "TemporalWorkflowNondeterministic")
      ?.expr.value;
    const maintenanceExpr = groups
      .find((group) => group.name === "temporal-workflow-failures")
      ?.rules?.find(
        (rule) =>
          rule.alert === "TemporalDomainActivityPollerUnavailable" &&
          rule.labels?.["task_queue"] === "maintenance",
      )?.expr.value;
    const glitterRule = groups
      .find((group) => group.name === "glitter-discord-corpus")
      ?.rules?.find(
        (rule) => rule.alert === "GlitterCorpusInventoryScopeChanged",
      );
    expect(glitterRule?.expr.value).toBe(
      'sum(glitter_corpus_inventory_scope_changes{change=~"removed|scope-decision-changed"}) > 0',
    );
    expect(glitterRule?.annotations?.["description"]).toContain(
      "removed or newly excluded channels or threads",
    );

    await runPromtoolFixture({
      evaluation_interval: "1m",
      tests: [
        {
          interval: "1m",
          input_series: [
            {
              series:
                'temporal_worker_num_pollers{namespace="woodpecker-ci",exported_namespace="prod",task_queue="maintenance",poller_type="activity_task"}',
              values: "0x10",
            },
            {
              series:
                'temporal_worker_worker_task_slots_used{namespace="woodpecker-ci",exported_namespace="prod",task_queue="maintenance",worker_type="ActivityWorker"}',
              values: "1x10",
            },
            {
              series: 'glitter_corpus_inventory_scope_changes{change="added"}',
              values: "4x10",
            },
            {
              series:
                'temporal_worker_workflow_task_execution_failed_total{exported_namespace="prod",task_queue="monorepo-workflows",workflow_type="photonConversationWorkflow",failure_reason="NonDeterminismError",pod="retained-a"}',
              values: "0 1 1 1 1 1 1 1 1 1",
            },
            {
              series:
                'temporal_worker_workflow_task_execution_failed_total{exported_namespace="prod",task_queue="monorepo-workflows",workflow_type="photonConversationWorkflow",failure_reason="NonDeterminismError",pod="retained-b"}',
              values: "0 0 0 0 1 1 1 1 1 1",
            },
          ],
          promql_expr_test: [
            { expr: maintenanceExpr, eval_time: "9m", exp_samples: [] },
            {
              expr: glitterRule?.expr.value,
              eval_time: "9m",
              exp_samples: [],
            },
            {
              expr: `count(${String(healthExpr)})`,
              eval_time: "9m",
              exp_samples: [{ labels: "{}", value: 1 }],
            },
          ],
        },
        {
          interval: "1m",
          input_series: [
            {
              series:
                'temporal_worker_num_pollers{namespace="woodpecker-ci",exported_namespace="prod",task_queue="maintenance",poller_type="activity_task"}',
              values: "0x10",
            },
            {
              series:
                'temporal_worker_worker_task_slots_used{namespace="woodpecker-ci",exported_namespace="prod",task_queue="maintenance",worker_type="ActivityWorker"}',
              values: "0x10",
            },
            {
              series:
                'glitter_corpus_inventory_scope_changes{change="removed"}',
              values: "1x10",
            },
          ],
          promql_expr_test: [
            {
              expr: maintenanceExpr,
              eval_time: "9m",
              exp_samples: [{ labels: "{}", value: 0 }],
            },
            {
              expr: glitterRule?.expr.value,
              eval_time: "9m",
              exp_samples: [{ labels: "{}", value: 1 }],
            },
          ],
        },
      ],
    });
  });
});

const repoLatencyBucket = (le: string, values: string) => ({
  series: `temporal_worker_activity_schedule_to_start_latency_seconds_bucket{namespace="temporal",exported_namespace="prod",task_queue="repo-automation",le="${le}"}`,
  values,
});

describe("Delivery state-machine exclusion", () => {
  test("excludes Delivery deployment and worker-recovery workflows from generic activity failure rules", () => {
    const retriesRule = getTemporalRuleGroups()
      .find((group) => group.name === "temporal-platform-health")
      ?.rules?.find(
        (rule) => rule.alert === "TemporalActivityRetriesExhausted",
      );
    expect(retriesRule?.expr.value).toContain(
      'workflowType!~"deliveryDeploymentWorkflow|deliveryWorkerRecoveryWorkflow"',
    );
    expect(findFailureRule("TemporalWorkflowActivityFailing")).toContain(
      'workflowType!~"deliveryDeploymentWorkflow|deliveryWorkerRecoveryWorkflow"',
    );
  });
});

describe("Scout Data Dragon failure rules", () => {
  test("ScoutDataDragonAutoMergeFailed alerts on the last-failure recency gauge", () => {
    const expression = findFailureRule("ScoutDataDragonAutoMergeFailed");
    // Recency gauge + age-out window, so the alert fires on the first failure
    // AND clears 24h later — a bare counter can't do both (increase() misses the
    // first born-at-1 failure; max_over_time(counter) never ages out).
    //
    // Timestamp gauges are exported without a unit suffix, even though the
    // duration histogram uses `_s`. Match the observed gauge contract.
    expect(expression).toContain(
      "scout_data_dragon_auto_merge_last_failure_timestamp[",
    );
    expect(expression).not.toContain(
      "scout_data_dragon_auto_merge_last_failure_timestamp_s",
    );
    expect(expression).toContain("time() -");
    expect(expression).toContain("60 * 60 * 24");
    // Read through a 24h max_over_time range, not a bare instant vector, so a
    // single-replica worker restart doesn't stale the series and wrongly clear
    // the alert.
    expect(expression).toContain(
      "max_over_time(scout_data_dragon_auto_merge_last_failure_timestamp[24h])",
    );
    expect(expression).not.toContain("increase(");
  });

  test("ScoutDataDragonPrAutomationFailed and ScoutDataDragonUpdateFailed partition failure reasons without overlap", async () => {
    const prExpr = findFailureRule("ScoutDataDragonPrAutomationFailed");
    const updateExpr = findFailureRule("ScoutDataDragonUpdateFailed");
    expect(prExpr).not.toContain("pr-merge-failed");
    expect(prExpr).toContain('reason=~"git-push-failed|pr-create-failed"');
    expect(updateExpr).toContain('reason!~"git-push-failed|pr-create-failed"');

    await runPromtoolFixture({
      evaluation_interval: "1m",
      tests: [
        {
          interval: "1m",
          input_series: [
            {
              series:
                'scout_data_dragon_last_failure_timestamp{reason="git-push-failed"}',
              values: "300x10",
            },
            {
              series:
                'scout_data_dragon_last_failure_timestamp{reason="s3-upload-failed"}',
              values: "300x10",
            },
          ],
          promql_expr_test: [
            {
              expr: prExpr,
              eval_time: "9m",
              exp_samples: [
                { labels: '{reason="git-push-failed"}', value: 240 },
              ],
            },
            {
              expr: updateExpr,
              eval_time: "9m",
              exp_samples: [
                { labels: '{reason="s3-upload-failed"}', value: 240 },
              ],
            },
          ],
        },
      ],
    });
  });

  test("TemporalDomainScheduleToStartHigh requires sustained >10s p95 alongside live >5s server backlog age", async () => {
    const rules =
      getTemporalRuleGroups().find(
        (group) => group.name === "temporal-workflow-failures",
      )?.rules ?? [];
    const latencyRules = rules.filter(
      (rule) => rule.alert === "TemporalDomainScheduleToStartHigh",
    );
    for (const rule of latencyRules) {
      expect(rule.for).toBe("10m");
      expect(rule.keepFiringFor).toBe("10m");
      expect(rule.expr.value).toContain("> 10");
      expect(rule.expr.value).toContain("approximate_backlog_age_seconds");
    }
    const repoRule = latencyRules.find(
      (rule) => rule.labels?.["task_queue"] === "repo-automation",
    );
    const repoExpr = repoRule?.expr.value;

    await runPromtoolFixture({
      evaluation_interval: "1m",
      tests: [
        {
          interval: "1m",
          input_series: [
            repoLatencyBucket("10", "0x10"),
            repoLatencyBucket("20", "0+1x10"),
            repoLatencyBucket("+Inf", "0+1x10"),
            {
              series:
                'approximate_backlog_age_seconds{namespace="temporal",exported_namespace="prod",taskqueue="repo_automation",task_type="Activity"}',
              values: "0x10",
            },
          ],
          promql_expr_test: [
            { expr: repoExpr, eval_time: "9m", exp_samples: [] },
          ],
        },
        {
          interval: "1m",
          input_series: [
            repoLatencyBucket("10", "0x10"),
            repoLatencyBucket("20", "0+1x10"),
            repoLatencyBucket("+Inf", "0+1x10"),
            {
              series:
                'approximate_backlog_age_seconds{namespace="temporal",exported_namespace="prod",taskqueue="repo_automation",task_type="Activity"}',
              values: "12x10",
            },
          ],
          promql_expr_test: [
            {
              expr: repoExpr,
              eval_time: "9m",
              exp_samples: [
                {
                  labels:
                    '{exported_namespace="prod",task_queue="repo-automation"}',
                  value: 19.5,
                },
              ],
            },
          ],
        },
      ],
    });
  });
});

describe("Prometheus rule shape", () => {
  // An increase() alert is only true for as long as its events stay inside the
  // lookback window. If the pending period is at or beyond that window, a
  // burst of events ages out before the rule can reach firing state and the
  // alert silently never fires — which is how TemporalActivitiesNeverStarting
  // shipped as increase(...[1h]) with for: 2h, unable to report the very
  // zero-poller queue it was written for. Asserted over every rule so the
  // next one written this way fails here instead of in production silence.
  test("no increase() rule has a pending period its lookback window cannot outlast", () => {
    const offenders: string[] = [];
    for (const group of getTemporalRuleGroups()) {
      for (const rule of group.rules ?? []) {
        const expression = rule.expr.value;
        const pending = rule.for;
        if (typeof expression !== "string" || pending === undefined) continue;
        const windows = [
          ...expression.matchAll(/increase\([^)]*\[(?<window>\d+[smhd])\]\)/gu),
        ]
          .map((match) => match.groups?.["window"])
          .filter((window) => window !== undefined);
        if (windows.length === 0) continue;
        const shortest = Math.min(
          ...windows.map((window) => parseDuration(window)),
        );
        if (parseDuration(pending) >= shortest) {
          offenders.push(`${rule.alert ?? "(unnamed)"} for=${pending}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
