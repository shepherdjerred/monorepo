import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

export const BUILDKITE_JOB_POD_PATTERN =
  "buildkite-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[a-z0-9]+";
export const BUILDKITE_POD_PARENT_CGROUP_PATTERN =
  "/kubepods(/[^/]+)*/pod[^/]+";
export const BUILDKITE_POD_CHILD_CGROUP_PATTERN =
  "/kubepods(/[^/]+)*/pod[^/]+/.+";
export const BUILDKITE_POD_LIFETIME_WRITES_SEEN_24H_BUDGET_BYTES = 4_398_046_511_104;
export const BUILDKITE_POD_LIFETIME_WRITES_SEEN_24H_METRIC =
  "buildkite:pod_parent_fs_writes_bytes:pod_lifetime_max_seen_24h";
export const BUILDKITE_POD_PARENT_FS_WRITES_BYTES_BY_JOB_METRIC =
  "buildkite:pod_parent_fs_writes_bytes_by_job_total";

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

function buildkitePodLabels(): string {
  // Defensively drop scrape-target labels before arithmetic joins so each
  // namespace/pod/metadata tuple stays unique if scrape topology changes.
  return `max by (namespace, pod, ${POD_LABEL_METADATA}) (
  kube_pod_labels{namespace="buildkite", label_buildkite_com_job_uuid!=""}
)`;
}

function buildkitePodAnnotations(): string {
  return `max by (namespace, pod, ${POD_ANNOTATION_METADATA}) (
  kube_pod_annotations{namespace="buildkite", annotation_buildkite_com_job_url!=""}
)`;
}

function withBuildkitePodMetadata(expression: string): string {
  return `(
  ${expression}
)
* on (namespace, pod) group_left(${POD_LABEL_METADATA})
  ${buildkitePodLabels()}
* on (namespace, pod) group_left(${POD_ANNOTATION_METADATA})
  ${buildkitePodAnnotations()}`;
}

function podParentCounter(metric: string): string {
  return `max by (namespace, pod, node, device) (
    ${metric}{
      namespace="buildkite",
      pod=~"${BUILDKITE_JOB_POD_PATTERN}",
      container="",
      id=~"${BUILDKITE_POD_PARENT_CGROUP_PATTERN}"
    }
  )`;
}

function attributedPodParentCounter(metric: string): string {
  return withBuildkitePodMetadata(podParentCounter(metric));
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
          // Keep aggregate accounting independent of kube-state-metrics while
          // exposing a separately enriched series for per-job attribution.
          record: BUILDKITE_POD_PARENT_FS_WRITES_BYTES_BY_JOB_METRIC,
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            attributedPodParentCounter("container_fs_writes_bytes_total"),
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
            `${BUILDKITE_POD_PARENT_FS_WRITES_BYTES_BY_JOB_METRIC} * 0 + 1`,
          ),
        },
      ],
    },
    {
      name: "buildkite-ci-io-rollups",
      interval: "5m",
      rules: [
        {
          // Conservative cohort accounting for ephemeral CI pods: each
          // pod/device series seen in the last 24 hours contributes its maximum
          // lifetime counter. A series crossing the left boundary therefore
          // includes earlier writes, and a completed series remains until its
          // last sample ages out. This is deliberately not an exact 24h delta.
          record: BUILDKITE_POD_LIFETIME_WRITES_SEEN_24H_METRIC,
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "sum(max_over_time(buildkite:pod_parent_fs_writes_bytes_total[24h]))",
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
            summary:
              "A running Buildkite job pod has no attributed parent-cgroup I/O samples",
            description: escapePrometheusTemplate(
              "Buildkite pod {{ $labels.pod }} has been running for more than one minute without a unique, metadata-attributed pod-parent filesystem sample.",
            ),
          },
          // Select the running cohort from the pod name itself. Requiring
          // kube_pod_labels here would make a pod with missing KSM metadata
          // invisible to the alert that is intended to detect that gap.
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(`
  max by (namespace, pod) (
    kube_pod_status_phase{
      namespace="buildkite",
      pod=~"${BUILDKITE_JOB_POD_PATTERN}",
      phase="Running"
    } == 1
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
          alert: "BuildkiteCIPodLifetimeWritesSeen24hBudgetExceeded",
          annotations: {
            summary:
              "Buildkite pod-lifetime writes seen in 24 hours exceeded the rounded operational budget",
            description: escapePrometheusTemplate(
              "Buildkite pod/device lifetime maxima seen in the last 24 hours total {{ $value | humanize1024 }}B. Pods crossing the left boundary include earlier writes, and completed pods remain until their last sample ages out. This conservative cohort value is not an exact 24-hour write delta. The rounded 4 TiB operational guardrail across every node running CI is separate from the reporter's exact fixed-corpus 50% acceptance gate.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `${BUILDKITE_POD_LIFETIME_WRITES_SEEN_24H_METRIC} > ${String(BUILDKITE_POD_LIFETIME_WRITES_SEEN_24H_BUDGET_BYTES)}`,
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
            summary: "Buildkite controller metrics are missing or unhealthy",
            description:
              "The Buildkite controller is available, but its monitor health metric has been absent or reported unhealthy for five minutes.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(`(
  sum(kube_deployment_status_replicas_available{
    namespace="buildkite",
    deployment="buildkite-agent-stack-k8s"
  }) > 0
)
and on ()
  (
    absent(buildkite_monitor_monitor_up{namespace="buildkite"})
    or on ()
    max(buildkite_monitor_monitor_up{namespace="buildkite"}) == 0
  )`),
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
