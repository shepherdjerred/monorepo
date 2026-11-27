import { describe, expect, it } from "vitest";
import type {
  PrometheusRuleSpecGroups,
  PrometheusRuleSpecGroupsRules,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { runPromtoolFixture } from "./platform/promtool-fixture.ts";
import {
  CI_NODE_CPU_HEADROOM_IDLE_RATIO,
  CI_PENDING_QUEUE_FOR,
  CI_PENDING_STEPS_THRESHOLD,
} from "./woodpecker-queue.ts";
import {
  CI_JOB_POD_PATTERN,
  CI_POD_CHILD_CGROUP_PATTERN,
  CI_POD_LIFETIME_WRITES_SEEN_24H_BUDGET_BYTES,
  CI_POD_LIFETIME_WRITES_SEEN_24H_METRIC,
  CI_POD_PARENT_CGROUP_PATTERN,
  CI_POD_PARENT_FS_WRITES_BYTES_BY_JOB_METRIC,
  CI_WORKSPACE_LEAK_AGE_SECONDS,
  CI_WORKSPACE_REAP_ACTIVITY,
  CI_WORKSPACE_REAPER_GRACE_SECONDS,
  getWoodpeckerRuleGroups,
} from "./woodpecker.ts";

const groups = getWoodpeckerRuleGroups();

function rulesForGroup(
  group: PrometheusRuleSpecGroups,
): PrometheusRuleSpecGroupsRules[] {
  if (group.rules === undefined) {
    throw new Error(`Prometheus rule group ${group.name} has no rules`);
  }
  return group.rules;
}

function findGroup(name: string): PrometheusRuleSpecGroups {
  const group = groups.find((candidate) => candidate.name === name);
  if (group === undefined) {
    throw new Error(`expected Prometheus rule group ${name} was not found`);
  }
  return group;
}

function ruleExpression(rule: PrometheusRuleSpecGroupsRules): string {
  const expression = rule.expr.value;
  if (typeof expression !== "string") {
    throw new TypeError("expected Prometheus rule expression to be a string");
  }
  return expression;
}

function findRule(
  predicate: (rule: PrometheusRuleSpecGroupsRules) => boolean,
): PrometheusRuleSpecGroupsRules {
  for (const group of groups) {
    const rule = rulesForGroup(group).find((candidate) => predicate(candidate));
    if (rule !== undefined) return rule;
  }
  throw new Error("expected Woodpecker Prometheus rule was not found");
}

function recordingRule(name: string): PrometheusRuleSpecGroupsRules {
  return findRule((rule) => rule.record === name);
}

function alertRule(name: string): PrometheusRuleSpecGroupsRules {
  return findRule((rule) => rule.alert === name);
}

// Two CPUs, each counting idle seconds at `idleRate` per second.
function cpus(idleRate: number) {
  return [0, 1].map((cpu) => ({
    series: `node_cpu_seconds_total{node="liskov",mode="idle",cpu="${String(cpu)}"}`,
    values: `0+${String(idleRate * 60)}x20`,
  }));
}

describe("Woodpecker CI I/O recording rules", () => {
  it("evaluates parent and child counters at the 10-second scrape cadence", () => {
    const recordingGroup = findGroup("woodpecker-ci-io-recording");
    expect(recordingGroup.interval).toBe("10s");
    expect(rulesForGroup(recordingGroup).map((rule) => rule.record)).toEqual([
      "woodpecker:pod_parent_fs_writes_bytes_total",
      CI_POD_PARENT_FS_WRITES_BYTES_BY_JOB_METRIC,
      "woodpecker:pod_parent_fs_reads_bytes_total",
      "woodpecker:pod_parent_fs_writes_total",
      "woodpecker:pod_parent_fs_reads_total",
      "woodpecker:pod_parent_io_waiting_seconds_total",
      "woodpecker:pod_parent_io_stalled_seconds_total",
      "woodpecker:container_fs_writes_bytes_total",
      "woodpecker:container_fs_reads_bytes_total",
      "woodpecker:pod_parent_sample_present",
    ]);
  });

  it("deduplicates each pod-parent device before the lifetime sum", () => {
    const rule = recordingRule("woodpecker:pod_parent_fs_writes_bytes_total");
    const expression = ruleExpression(rule);

    expect(expression).toContain("max by (namespace, pod, node, device)");
    expect(expression).toContain('container=""');
    expect(expression).toContain(`pod=~"${CI_JOB_POD_PATTERN}"`);
    expect(expression).toContain(`id=~"${CI_POD_PARENT_CGROUP_PATTERN}"`);
    expect(expression).not.toContain(CI_POD_CHILD_CGROUP_PATTERN);
    expect(expression).not.toContain(
      "woodpecker:container_fs_writes_bytes_total",
    );
    expect(expression).not.toContain("kube_pod_labels");
    expect(expression).not.toContain("kube_pod_annotations");
  });

  it("keeps child counters separate for container attribution", () => {
    const rule = recordingRule("woodpecker:container_fs_writes_bytes_total");
    const expression = ruleExpression(rule);

    expect(expression).toContain(
      "max by (namespace, pod, node, container, device)",
    );
    expect(expression).toContain('container!=""');
    expect(expression).toContain('container!="POD"');
    expect(expression).toContain(`id=~"${CI_POD_CHILD_CGROUP_PATTERN}"`);
    expect(expression).not.toContain(`id=~"${CI_POD_PARENT_CGROUP_PATTERN}"`);
  });

  // Woodpecker's own pod metadata identifies nothing -- its pod names carry a
  // ULID and a step index -- so every key joined here is stamped by the
  // configuration extension. Spelled out rather than imported: this is one of
  // three files that must agree on the exact flattened names, and a shared
  // constant would let all three drift together.
  it("retains the identity and link metadata the extension stamps", () => {
    const rule = recordingRule(CI_POD_PARENT_FS_WRITES_BYTES_BY_JOB_METRIC);
    const expression = ruleExpression(rule);

    expect(expression).toContain("label_ci_sjer_red_step_key");
    expect(expression).toContain("label_ci_sjer_red_commit");
    expect(expression).toContain("annotation_ci_sjer_red_branch");
    expect(expression).toContain("annotation_ci_sjer_red_pipeline_url");
    expect(expression).toContain("group_left");
  });

  it("normalizes metadata to one namespace/pod tuple before joining", () => {
    const rule = recordingRule(CI_POD_PARENT_FS_WRITES_BYTES_BY_JOB_METRIC);
    const expression = ruleExpression(rule);

    expect(expression).toContain(
      "max by (namespace, pod, label_ci_sjer_red_commit, label_ci_sjer_red_step_key)",
    );
    expect(expression).toContain(
      "max by (namespace, pod, annotation_ci_sjer_red_branch, annotation_ci_sjer_red_pipeline_url)",
    );
  });

  it("records one sample-presence series from parent-cgroup CPU and pod metadata", async () => {
    const rule = recordingRule("woodpecker:pod_parent_sample_present");
    const expression = ruleExpression(rule);
    expect(expression).toContain("container_cpu_usage_seconds_total");
    expect(expression).toContain("max by (namespace, pod, node)");
    expect(expression).toContain('container=""');
    expect(expression).toContain(`pod=~"${CI_JOB_POD_PATTERN}"`);
    expect(expression).toContain(`id=~"${CI_POD_PARENT_CGROUP_PATTERN}"`);
    expect(expression).toContain("label_ci_sjer_red_step_key");
    expect(expression).toContain("annotation_ci_sjer_red_pipeline_url");
    expect(expression).toContain("* 0 + 1");
    expect(expression).not.toContain("container_fs_writes_bytes_total");

    const pod = "wp-01k8x9m2n4p6q8r0s2t4v6w8y0";
    const missingExpr = ruleExpression(
      alertRule("WoodpeckerCIIOTelemetryMissing"),
    ).replace("woodpecker:pod_parent_sample_present", `(${expression})`);
    await runPromtoolFixture({
      evaluation_interval: "10s",
      tests: [
        {
          interval: "10s",
          input_series: [
            {
              series: `kube_pod_status_phase{namespace="woodpecker-ci",pod="${pod}",phase="Running"}`,
              values: "1x12",
            },
            {
              series: `container_cpu_usage_seconds_total{namespace="woodpecker-ci",pod="${pod}",node="liskov",container="",id="/kubepods/burstable/pod123"}`,
              values: "0x12",
            },
            {
              series: `kube_pod_labels{namespace="woodpecker-ci",pod="${pod}",label_ci_sjer_red_commit="abc123",label_ci_sjer_red_step_key="codex-review-gate"}`,
              values: "1x12",
            },
            {
              series: `kube_pod_annotations{namespace="woodpecker-ci",pod="${pod}",annotation_ci_sjer_red_branch="main",annotation_ci_sjer_red_pipeline_url="https://woodpecker.sjer.red/repos/1/pipeline/2"}`,
              values: "1x12",
            },
          ],
          promql_expr_test: [
            {
              expr: expression,
              eval_time: "1m",
              exp_samples: [
                {
                  labels: `{annotation_ci_sjer_red_branch="main",annotation_ci_sjer_red_pipeline_url="https://woodpecker.sjer.red/repos/1/pipeline/2",label_ci_sjer_red_commit="abc123",label_ci_sjer_red_step_key="codex-review-gate",namespace="woodpecker-ci",node="liskov",pod="${pod}"}`,
                  value: 1,
                },
              ],
            },
            { expr: missingExpr, eval_time: "1m", exp_samples: [] },
          ],
        },
        {
          interval: "10s",
          input_series: [
            {
              series: `kube_pod_status_phase{namespace="woodpecker-ci",pod="${pod}",phase="Running"}`,
              values: "1x12",
            },
            {
              series: `container_cpu_usage_seconds_total{namespace="woodpecker-ci",pod="${pod}",node="liskov",container="",id="/kubepods/burstable/pod123"}`,
              values: "0x12",
            },
          ],
          promql_expr_test: [
            { expr: expression, eval_time: "1m", exp_samples: [] },
            {
              expr: missingExpr,
              eval_time: "1m",
              exp_samples: [
                {
                  labels: `{namespace="woodpecker-ci",pod="${pod}"}`,
                  value: 1,
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("rolls the conservative pod-lifetime cohort total up at a slower cadence", () => {
    const rollupGroup = findGroup("woodpecker-ci-io-rollups");
    const rule = recordingRule(CI_POD_LIFETIME_WRITES_SEEN_24H_METRIC);

    expect(rollupGroup.interval).toBe("5m");
    expect(CI_POD_LIFETIME_WRITES_SEEN_24H_METRIC).toContain(
      "pod_lifetime_max_seen_24h",
    );
    expect(ruleExpression(rule)).toBe(
      "sum(max_over_time(woodpecker:pod_parent_fs_writes_bytes_total[24h]))",
    );
  });
});

describe("Woodpecker CI I/O informational alerts", () => {
  it("detects running jobs that never receive a parent-cgroup sample", () => {
    const rule = alertRule("WoodpeckerCIIOTelemetryMissing");
    const expression = ruleExpression(rule);
    expect(expression).toContain('phase="Running"');
    expect(expression).toContain(`pod=~"${CI_JOB_POD_PATTERN}"`);
    expect(expression).toContain("unless on (namespace, pod)");
    expect(expression).toContain("woodpecker:pod_parent_sample_present");
    expect(expression).not.toContain("kube_pod_labels");
    expect(expression).not.toContain("label_woodpecker_com_job_uuid");
    expect(rule.annotations?.["description"]).toContain("$labels.pod");
    expect(rule.for).toBe("1m");
    expect(rule.labels?.["severity"]).toBe("info");
  });

  it("uses the accepted 4 TiB pod-lifetime cohort budget across all pods", () => {
    const rule = alertRule(
      "WoodpeckerCIPodLifetimeWritesSeen24hBudgetExceeded",
    );
    expect(ruleExpression(rule)).toBe(
      `${CI_POD_LIFETIME_WRITES_SEEN_24H_METRIC} > ${String(CI_POD_LIFETIME_WRITES_SEEN_24H_BUDGET_BYTES)}`,
    );
    expect(rule.annotations?.["summary"]).toBe(
      "Woodpecker CI 24-hour disk write volume exceeded 4 TiB budget",
    );
    expect(rule.annotations?.["description"]).toContain("humanize1024");
    expect(rule.annotations?.["description"]).toContain("4 TiB");
    expect(CI_POD_LIFETIME_WRITES_SEEN_24H_BUDGET_BYTES).toBe(4 * 1024 ** 4);
    expect(rule.labels?.["severity"]).toBe("info");
  });

  it("alerts on a sustained Woodpecker queue while liskov has CPU headroom", async () => {
    const rule = alertRule("WoodpeckerPendingQueueWithCpuHeadroom");
    const expr = ruleExpression(rule);
    expect(CI_PENDING_STEPS_THRESHOLD).toBe(20);
    expect(CI_NODE_CPU_HEADROOM_IDLE_RATIO).toBe(0.4);
    // Held 30 minutes it fired 20 times in 14 days; 2 hours keeps it to a
    // sustained regression.
    expect(CI_PENDING_QUEUE_FOR).toBe("2h");
    expect(rule.for).toBe(CI_PENDING_QUEUE_FOR);
    expect(rule.labels?.["severity"]).toBe("warning");
    expect(rule.labels?.["category"]).toBe("ci");

    const scenario = (
      name: string,
      pending: number,
      idleRate: number,
      expected: number | undefined,
    ) => ({
      interval: "1m",
      name,
      input_series: [
        {
          series: 'woodpecker_pending_steps{namespace="woodpecker"}',
          values: `${String(pending)}x20`,
        },
        ...cpus(idleRate),
      ],
      promql_expr_test: [
        {
          expr,
          eval_time: "15m",
          exp_samples:
            expected === undefined ? [] : [{ labels: "{}", value: expected }],
        },
      ],
    });
    await runPromtoolFixture({
      evaluation_interval: "1m",
      tests: [
        scenario("queued with spare CPU", 253, 0.7, 253),
        // At 80% busy the node is genuinely saturated: not this signature.
        scenario("queued and saturated", 253, 0.2, undefined),
        scenario("short queue with spare CPU", 20, 0.7, undefined),
      ],
    });
  });

  /**
   * The workspace class deletes each volume with its claim, so a claim that
   * outlives every possible workflow is one Woodpecker failed to delete --
   * and space on the CI pool that nothing will reclaim.
   */
  it("flags workspace claims that outlive any workflow", () => {
    const rule = alertRule("WoodpeckerWorkspaceClaimLeaked");
    const expression = ruleExpression(rule);
    expect(expression).toContain(
      'kube_persistentvolumeclaim_created{namespace="woodpecker-ci"}',
    );
    expect(expression).toContain('storageclass="ci-workspace"');
    expect(expression).toContain(
      `> ${String(CI_WORKSPACE_LEAK_AGE_SECONDS + CI_WORKSPACE_REAPER_GRACE_SECONDS)}`,
    );
    // Past the 270-minute workflow timeout, with margin.
    expect(CI_WORKSPACE_LEAK_AGE_SECONDS).toBeGreaterThan(270 * 60);
    // Past one 15-minute reaper interval plus a 45-minute infra queue hold.
    expect(CI_WORKSPACE_REAPER_GRACE_SECONDS).toBeGreaterThan(60 * 60);
    expect(rule.labels?.["severity"]).toBe("warning");
  });

  it("flags a reaper that stopped succeeding", () => {
    const rule = alertRule("WoodpeckerWorkspaceReaperStale");
    const expression = ruleExpression(rule);
    expect(expression).toContain(
      `kubernetes_maintenance_last_success_timestamp_seconds{maintenance_job="${CI_WORKSPACE_REAP_ACTIVITY}"}`,
    );
    expect(CI_WORKSPACE_REAP_ACTIVITY).toBe("ci-workspace-reap");
    expect(rule.labels?.["severity"]).toBe("warning");
  });

  it("keeps the CI I/O alerts as non-paging informational telemetry", () => {
    const alerts = [
      alertRule("WoodpeckerCIIOTelemetryMissing"),
      alertRule("WoodpeckerCIPodLifetimeWritesSeen24hBudgetExceeded"),
    ];
    expect(alerts).toHaveLength(2);
    expect(alerts.every((rule) => rule.labels?.["severity"] === "info")).toBe(
      true,
    );
  });
});
