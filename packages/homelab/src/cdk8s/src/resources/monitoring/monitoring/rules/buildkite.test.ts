import { describe, expect, it } from "bun:test";
import type { PrometheusRuleSpecGroupsRules } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import {
  BUILDKITE_DAILY_WRITE_BUDGET_BYTES,
  BUILDKITE_JOB_POD_PATTERN,
  BUILDKITE_POD_CHILD_CGROUP_PATTERN,
  BUILDKITE_POD_PARENT_CGROUP_PATTERN,
  getBuildkiteRuleGroups,
} from "./buildkite.ts";

const groups = getBuildkiteRuleGroups();

function findRule(
  predicate: (rule: PrometheusRuleSpecGroupsRules) => boolean,
): PrometheusRuleSpecGroupsRules {
  for (const group of groups) {
    const rule = group.rules.find((candidate) => predicate(candidate));
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
    const recordingGroup = groups.find(
      (group) => group.name === "buildkite-ci-io-recording",
    );
    expect(recordingGroup).toBeDefined();
    expect(recordingGroup?.interval).toBe("10s");
    expect(recordingGroup?.rules.map((rule) => rule.record)).toEqual([
      "buildkite:pod_parent_fs_writes_bytes_total",
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

    expect(rule.expr).toContain("max by (namespace, pod, node, device)");
    expect(rule.expr).toContain('container=""');
    expect(rule.expr).toContain(`pod=~"${BUILDKITE_JOB_POD_PATTERN}"`);
    expect(rule.expr).toContain(`id=~"${BUILDKITE_POD_PARENT_CGROUP_PATTERN}"`);
    expect(rule.expr).not.toContain(BUILDKITE_POD_CHILD_CGROUP_PATTERN);
    expect(rule.expr).not.toContain(
      "buildkite:container_fs_writes_bytes_total",
    );
  });

  it("keeps child counters separate for container attribution", () => {
    const rule = recordingRule("buildkite:container_fs_writes_bytes_total");

    expect(rule.expr).toContain("sum by (namespace, pod, node, container)");
    expect(rule.expr).toContain('container!=""');
    expect(rule.expr).toContain('container!="POD"');
    expect(rule.expr).toContain(`id=~"${BUILDKITE_POD_CHILD_CGROUP_PATTERN}"`);
    expect(rule.expr).not.toContain(
      `id=~"${BUILDKITE_POD_PARENT_CGROUP_PATTERN}"`,
    );
  });

  it("retains the stable Buildkite identity and link metadata", () => {
    const rule = recordingRule("buildkite:pod_parent_fs_writes_bytes_total");

    expect(rule.expr).toContain("label_buildkite_com_job_uuid");
    expect(rule.expr).toContain("label_ci_sjer_red_step_key");
    expect(rule.expr).toContain("annotation_buildkite_com_build_branch");
    expect(rule.expr).toContain("annotation_buildkite_com_build_url");
    expect(rule.expr).toContain("annotation_buildkite_com_job_url");
    expect(rule.expr).toContain("annotation_buildkite_com_pipeline_slug");
    expect(rule.expr).toContain("group_left");
  });

  it("records one sample-presence series from the parent counter only", () => {
    const rule = recordingRule("buildkite:pod_parent_sample_present");
    expect(rule.expr).toBe(
      "max by (namespace, pod) (buildkite:pod_parent_fs_writes_bytes_total * 0 + 1)",
    );
  });
});

describe("Buildkite CI I/O informational alerts", () => {
  it("detects running jobs that never receive a parent-cgroup sample", () => {
    const rule = alertRule("BuildkiteCIIOTelemetryMissing");
    expect(rule.expr).toContain('phase="Running"');
    expect(rule.expr).toContain("unless on (namespace, pod)");
    expect(rule.expr).toContain("buildkite:pod_parent_sample_present");
    expect(rule.for).toBe("1m");
    expect(rule.labels?.["severity"]).toBe("info");
  });

  it("uses the accepted 4 TiB rolling write budget across all pods", () => {
    const rule = alertRule("BuildkiteCIWriteBudgetExceeded");
    expect(rule.expr).toBe(
      `sum(max_over_time(buildkite:pod_parent_fs_writes_bytes_total[24h])) > ${String(BUILDKITE_DAILY_WRITE_BUDGET_BYTES)}`,
    );
    expect(BUILDKITE_DAILY_WRITE_BUDGET_BYTES).toBe(4 * 1024 ** 4);
    expect(rule.labels?.["severity"]).toBe("info");
  });

  it("detects a running controller whose metrics target disappeared", () => {
    const rule = alertRule("BuildkiteControllerMetricsMissing");
    expect(rule.expr).toContain('deployment="buildkite-agent-stack-k8s"');
    expect(rule.expr).toContain(
      'absent(buildkite_monitor_monitor_up{namespace="buildkite"})',
    );
    expect(rule.for).toBe("5m");
    expect(rule.labels?.["severity"]).toBe("info");
  });

  it("routes every new alert as non-paging informational telemetry", () => {
    const alerts = groups.flatMap((group) =>
      group.rules.filter((rule) => rule.alert !== undefined),
    );
    expect(alerts).toHaveLength(3);
    expect(alerts.every((rule) => rule.labels?.["severity"] === "info")).toBe(
      true,
    );
  });
});
