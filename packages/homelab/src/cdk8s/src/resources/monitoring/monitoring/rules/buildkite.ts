import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

export const BUILDKITE_JOB_POD_PATTERN =
  "buildkite-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[a-z0-9]+";
export const BUILDKITE_POD_PARENT_CGROUP_PATTERN =
  "/kubepods(/[^/]+)*/pod[^/]+";
export const BUILDKITE_POD_CHILD_CGROUP_PATTERN =
  "/kubepods(/[^/]+)*/pod[^/]+/.+";
export const BUILDKITE_DAILY_WRITE_BUDGET_BYTES = 4_398_046_511_104;

const POD_LABEL_METADATA = [
  "label_buildkite_com_job_uuid",
  "label_ci_sjer_red_step_key",
].join(", ");

const POD_ANNOTATION_METADATA = [
  "annotation_buildkite_com_build_branch",
  "annotation_buildkite_com_build_url",
  "annotation_buildkite_com_job_url",
  "annotation_buildkite_com_pipeline_slug",
].join(", ");

function withBuildkitePodMetadata(expression: string): string {
  return `(
  ${expression}
)
* on (namespace, pod) group_left(${POD_LABEL_METADATA})
  kube_pod_labels{namespace="buildkite", label_buildkite_com_job_uuid!=""}
* on (namespace, pod) group_left(${POD_ANNOTATION_METADATA})
  kube_pod_annotations{namespace="buildkite", annotation_buildkite_com_job_url!=""}`;
}

function podParentCounter(metric: string): string {
  return withBuildkitePodMetadata(
    `max by (namespace, pod, node, device) (
    ${metric}{
      namespace="buildkite",
      pod=~"${BUILDKITE_JOB_POD_PATTERN}",
      container="",
      id=~"${BUILDKITE_POD_PARENT_CGROUP_PATTERN}"
    }
  )`,
  );
}

function containerCounter(metric: string): string {
  return withBuildkitePodMetadata(
    `max by (namespace, pod, node, container, device) (
    ${metric}{
      namespace="buildkite",
      pod=~"${BUILDKITE_JOB_POD_PATTERN}",
      container!="",
      container!="POD",
      id=~"${BUILDKITE_POD_CHILD_CGROUP_PATTERN}"
    }
  )`,
  );
}

export function getBuildkiteRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "buildkite-ci-io-recording",
      interval: "10s",
      rules: [
        {
          record: "buildkite:pod_parent_fs_writes_bytes_total",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            podParentCounter("container_fs_writes_bytes_total"),
          ),
        },
        {
          record: "buildkite:pod_parent_fs_reads_bytes_total",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            podParentCounter("container_fs_reads_bytes_total"),
          ),
        },
        {
          record: "buildkite:pod_parent_fs_writes_total",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            podParentCounter("container_fs_writes_total"),
          ),
        },
        {
          record: "buildkite:pod_parent_fs_reads_total",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            podParentCounter("container_fs_reads_total"),
          ),
        },
        {
          record: "buildkite:pod_parent_io_waiting_seconds_total",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            podParentCounter("container_pressure_io_waiting_seconds_total"),
          ),
        },
        {
          record: "buildkite:pod_parent_io_stalled_seconds_total",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            podParentCounter("container_pressure_io_stalled_seconds_total"),
          ),
        },
        {
          record: "buildkite:container_fs_writes_bytes_total",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            containerCounter("container_fs_writes_bytes_total"),
          ),
        },
        {
          record: "buildkite:container_fs_reads_bytes_total",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            containerCounter("container_fs_reads_bytes_total"),
          ),
        },
        {
          record: "buildkite:pod_parent_sample_present",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "buildkite:pod_parent_fs_writes_bytes_total * 0 + 1",
          ),
        },
      ],
    },
    {
      name: "buildkite-ci-io-alerts",
      interval: "30s",
      rules: [
        {
          alert: "BuildkiteCIIOTelemetryMissing",
          annotations: {
            summary: "A running Buildkite job has no parent-cgroup I/O samples",
            description: escapePrometheusTemplate(
              "Buildkite job {{ $labels.label_buildkite_com_job_uuid }} (step {{ $labels.label_ci_sjer_red_step_key }}) has been running for more than one minute without a unique pod-parent filesystem sample.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(`(
  max by (namespace, pod) (
    kube_pod_status_phase{namespace="buildkite", phase="Running"} == 1
  )
  * on (namespace, pod) group_left(${POD_LABEL_METADATA})
    kube_pod_labels{namespace="buildkite", label_buildkite_com_job_uuid!=""}
)
unless on (namespace, pod)
  buildkite:pod_parent_sample_present`),
          for: "1m",
          labels: {
            severity: "info",
            category: "ci",
          },
        },
        {
          alert: "BuildkiteCIWriteBudgetExceeded",
          annotations: {
            summary:
              "Buildkite logical writes exceeded the rolling 24-hour budget",
            description: escapePrometheusTemplate(
              "Buildkite pod-parent writes were {{ $value | humanize1024 }}B over the last 24 hours. The post-optimization budget is 4 TiB across every node running CI.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `sum(max_over_time(buildkite:pod_parent_fs_writes_bytes_total[24h])) > ${String(BUILDKITE_DAILY_WRITE_BUDGET_BYTES)}`,
          ),
          for: "30m",
          labels: {
            severity: "info",
            category: "ci",
            namespace: "buildkite",
          },
        },
        {
          alert: "BuildkiteControllerMetricsMissing",
          annotations: {
            summary: "Buildkite controller metrics are not reaching Prometheus",
            description:
              "The Buildkite controller is available, but its native scheduling and cancellation metrics have been absent for five minutes.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(`(
  sum(kube_deployment_status_replicas_available{
    namespace="buildkite",
    deployment="buildkite-agent-stack-k8s"
  }) > 0
)
and on ()
  absent(buildkite_monitor_monitor_up{namespace="buildkite"})`),
          for: "5m",
          labels: {
            severity: "info",
            category: "ci",
            namespace: "buildkite",
          },
        },
      ],
    },
  ];
}
