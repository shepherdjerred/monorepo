import { describe, expect, it } from "vitest";
import type {
  PrometheusRuleSpecGroups,
  PrometheusRuleSpecGroupsRules,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import {
  CI_JOB_POD_PATTERN,
  CI_POD_CHILD_CGROUP_PATTERN,
  CI_POD_LIFETIME_WRITES_SEEN_24H_BUDGET_BYTES,
  CI_POD_LIFETIME_WRITES_SEEN_24H_METRIC,
  CI_POD_PARENT_CGROUP_PATTERN,
  CI_POD_PARENT_FS_WRITES_BYTES_BY_JOB_METRIC,
  CI_WORKSPACE_LEAK_AGE_SECONDS,
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

  it("records one sample-presence series from the parent counter only", () => {
    const rule = recordingRule("woodpecker:pod_parent_sample_present");
    expect(ruleExpression(rule)).toBe(
      `${CI_POD_PARENT_FS_WRITES_BYTES_BY_JOB_METRIC} * 0 + 1`,
    );
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
    expect(rule.annotations?.["description"]).toContain(
      "Pods crossing the left boundary include earlier writes",
    );
    expect(rule.annotations?.["description"]).toContain(
      "not an exact 24-hour write delta",
    );
    expect(rule.annotations?.["description"]).toContain(
      "separate from the reporter's exact fixed-corpus 50% acceptance gate",
    );
    expect(CI_POD_LIFETIME_WRITES_SEEN_24H_BUDGET_BYTES).toBe(4 * 1024 ** 4);
    expect(rule.labels?.["severity"]).toBe("info");
  });

  // An available agent Deployment that the server does not see is the
  // Woodpecker-shaped version of the old agent-stack-k8s controller alert:
  // workflows queue forever with nothing obviously broken.
  it("detects running agents that the server has no connection from", () => {
    const rule = alertRule("WoodpeckerAgentDisconnected");
    const expression = ruleExpression(rule);
    expect(expression).toContain('deployment="woodpecker-agent"');
    expect(expression).toContain(
      'absent(woodpecker_worker_count{namespace="woodpecker"})',
    );
    expect(expression).toContain(
      'max(woodpecker_worker_count{namespace="woodpecker"}) == 0',
    );
    expect(rule.for).toBe("5m");
    expect(rule.labels?.["severity"]).toBe("info");
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
    expect(expression).toContain(`> ${String(CI_WORKSPACE_LEAK_AGE_SECONDS)}`);
    // Past the 270-minute workflow timeout, with margin.
    expect(CI_WORKSPACE_LEAK_AGE_SECONDS).toBeGreaterThan(270 * 60);
    expect(rule.labels?.["severity"]).toBe("warning");
  });

  it("keeps the CI I/O alerts as non-paging informational telemetry", () => {
    const alerts = [
      alertRule("WoodpeckerCIIOTelemetryMissing"),
      alertRule("WoodpeckerCIPodLifetimeWritesSeen24hBudgetExceeded"),
      alertRule("WoodpeckerAgentDisconnected"),
    ];
    expect(alerts).toHaveLength(3);
    expect(alerts.every((rule) => rule.labels?.["severity"] === "info")).toBe(
      true,
    );
  });
});
