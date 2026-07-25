import { describe, expect, it } from "bun:test";
import type {
  PrometheusRuleSpecGroups,
  PrometheusRuleSpecGroupsRules,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import {
  BUILDKITE_JOB_POD_PATTERN,
  BUILDKITE_POD_CHILD_CGROUP_PATTERN,
  BUILDKITE_POD_LIFETIME_WRITES_SEEN_24H_BUDGET_BYTES,
  BUILDKITE_POD_LIFETIME_WRITES_SEEN_24H_METRIC,
  BUILDKITE_POD_PARENT_CGROUP_PATTERN,
  BUILDKITE_POD_PARENT_FS_WRITES_BYTES_BY_JOB_METRIC,
  getBuildkiteRuleGroups,
} from "./buildkite.ts";

const groups = getBuildkiteRuleGroups();

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
  throw new Error("expected Buildkite Prometheus rule was not found");
}

function recordingRule(name: string): PrometheusRuleSpecGroupsRules {
  return findRule((rule) => rule.record === name);
}

function alertRule(name: string): PrometheusRuleSpecGroupsRules {
  return findRule((rule) => rule.alert === name);
}

describe("Buildkite CI I/O recording rules", () => {
  it("evaluates parent and child counters at the 10-second scrape cadence", () => {
    const recordingGroup = findGroup("buildkite-ci-io-recording");
    expect(recordingGroup.interval).toBe("10s");
    expect(rulesForGroup(recordingGroup).map((rule) => rule.record)).toEqual([
      "buildkite:pod_parent_fs_writes_bytes_total",
      BUILDKITE_POD_PARENT_FS_WRITES_BYTES_BY_JOB_METRIC,
      "buildkite:pod_parent_fs_reads_bytes_total",
      "buildkite:pod_parent_fs_writes_total",
      "buildkite:pod_parent_fs_reads_total",
      "buildkite:pod_parent_io_waiting_seconds_total",
      "buildkite:pod_parent_io_stalled_seconds_total",
      "buildkite:container_fs_writes_bytes_total",
      "buildkite:container_fs_reads_bytes_total",
      "buildkite:pod_parent_sample_present",
    ]);
  });

  it("deduplicates each pod-parent device before the lifetime sum", () => {
    const rule = recordingRule("buildkite:pod_parent_fs_writes_bytes_total");
    const expression = ruleExpression(rule);

    expect(expression).toContain("max by (namespace, pod, node, device)");
    expect(expression).toContain('container=""');
    expect(expression).toContain(`pod=~"${BUILDKITE_JOB_POD_PATTERN}"`);
    expect(expression).toContain(
      `id=~"${BUILDKITE_POD_PARENT_CGROUP_PATTERN}"`,
    );
    expect(expression).not.toContain(BUILDKITE_POD_CHILD_CGROUP_PATTERN);
    expect(expression).not.toContain(
      "buildkite:container_fs_writes_bytes_total",
    );
    expect(expression).not.toContain("kube_pod_labels");
    expect(expression).not.toContain("kube_pod_annotations");
  });

  it("keeps child counters separate for container attribution", () => {
    const rule = recordingRule("buildkite:container_fs_writes_bytes_total");
    const expression = ruleExpression(rule);

    expect(expression).toContain(
      "max by (namespace, pod, node, container, device)",
    );
    expect(expression).toContain('container!=""');
    expect(expression).toContain('container!="POD"');
    expect(expression).toContain(`id=~"${BUILDKITE_POD_CHILD_CGROUP_PATTERN}"`);
    expect(expression).not.toContain(
      `id=~"${BUILDKITE_POD_PARENT_CGROUP_PATTERN}"`,
    );
  });

  it("retains the stable Buildkite identity and link metadata", () => {
    const rule = recordingRule(
      BUILDKITE_POD_PARENT_FS_WRITES_BYTES_BY_JOB_METRIC,
    );
    const expression = ruleExpression(rule);

    expect(expression).toContain("label_buildkite_com_job_uuid");
    expect(expression).toContain("label_ci_sjer_red_step_key");
    expect(expression).toContain("annotation_buildkite_com_build_branch");
    expect(expression).toContain("annotation_buildkite_com_build_url");
    expect(expression).toContain("annotation_buildkite_com_job_url");
    expect(expression).toContain("annotation_buildkite_com_pipeline_slug");
    expect(expression).toContain("group_left");
  });

  it("normalizes metadata to one namespace/pod tuple before joining", () => {
    const rule = recordingRule(
      BUILDKITE_POD_PARENT_FS_WRITES_BYTES_BY_JOB_METRIC,
    );
    const expression = ruleExpression(rule);

    expect(expression).toContain(
      "max by (namespace, pod, label_buildkite_com_job_uuid, label_ci_sjer_red_step_key)",
    );
    expect(expression).toContain(
      "max by (namespace, pod, annotation_buildkite_com_build_branch, annotation_buildkite_com_build_url, annotation_buildkite_com_job_url, annotation_buildkite_com_pipeline_slug)",
    );
  });

  it("records one sample-presence series from the parent counter only", () => {
    const rule = recordingRule("buildkite:pod_parent_sample_present");
    expect(ruleExpression(rule)).toBe(
      `${BUILDKITE_POD_PARENT_FS_WRITES_BYTES_BY_JOB_METRIC} * 0 + 1`,
    );
  });

  it("rolls the conservative pod-lifetime cohort total up at a slower cadence", () => {
    const rollupGroup = findGroup("buildkite-ci-io-rollups");
    const rule = recordingRule(BUILDKITE_POD_LIFETIME_WRITES_SEEN_24H_METRIC);

    expect(rollupGroup.interval).toBe("5m");
    expect(BUILDKITE_POD_LIFETIME_WRITES_SEEN_24H_METRIC).toContain(
      "pod_lifetime_max_seen_24h",
    );
    expect(ruleExpression(rule)).toBe(
      "sum(max_over_time(buildkite:pod_parent_fs_writes_bytes_total[24h]))",
    );
  });
});

describe("Buildkite CI I/O informational alerts", () => {
  it("detects running jobs that never receive a parent-cgroup sample", () => {
    const rule = alertRule("BuildkiteCIIOTelemetryMissing");
    const expression = ruleExpression(rule);
    expect(expression).toContain('phase="Running"');
    expect(expression).toContain(`pod=~"${BUILDKITE_JOB_POD_PATTERN}"`);
    expect(expression).toContain("unless on (namespace, pod)");
    expect(expression).toContain("buildkite:pod_parent_sample_present");
    expect(expression).not.toContain("kube_pod_labels");
    expect(expression).not.toContain("label_buildkite_com_job_uuid");
    expect(rule.annotations?.["description"]).toContain("$labels.pod");
    expect(rule.for).toBe("1m");
    expect(rule.labels?.["severity"]).toBe("info");
  });

  it("uses the accepted 4 TiB pod-lifetime cohort budget across all pods", () => {
    const rule = alertRule("BuildkiteCIPodLifetimeWritesSeen24hBudgetExceeded");
    expect(ruleExpression(rule)).toBe(
      `${BUILDKITE_POD_LIFETIME_WRITES_SEEN_24H_METRIC} > ${String(BUILDKITE_POD_LIFETIME_WRITES_SEEN_24H_BUDGET_BYTES)}`,
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
    expect(BUILDKITE_POD_LIFETIME_WRITES_SEEN_24H_BUDGET_BYTES).toBe(
      4 * 1024 ** 4,
    );
    expect(rule.labels?.["severity"]).toBe("info");
  });

  it("detects a running controller whose metrics loop is absent or stopped", () => {
    const rule = alertRule("BuildkiteControllerMetricsMissing");
    const expression = ruleExpression(rule);
    expect(expression).toContain('deployment="buildkite-agent-stack-k8s"');
    expect(expression).toContain(
      'absent(buildkite_monitor_monitor_up{namespace="buildkite"})',
    );
    expect(expression).toContain(
      'max(buildkite_monitor_monitor_up{namespace="buildkite"}) == 0',
    );
    expect(rule.for).toBe("5m");
    expect(rule.labels?.["severity"]).toBe("info");
  });

  it("routes every new alert as non-paging informational telemetry", () => {
    const alerts = groups.flatMap((group) =>
      rulesForGroup(group).filter((rule) => rule.alert !== undefined),
    );
    expect(alerts).toHaveLength(3);
    expect(alerts.every((rule) => rule.labels?.["severity"] === "info")).toBe(
      true,
    );
  });
});
