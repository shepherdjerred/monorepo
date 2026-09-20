import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

export const BUILDKITE_JOB_POD_PATTERN =
  "woodpecker-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[a-z0-9]+";
export const BUILDKITE_POD_PARENT_CGROUP_PATTERN =
  "/kubepods(/[^/]+)*/pod[^/]+";
export const BUILDKITE_POD_CHILD_CGROUP_PATTERN =
  "/kubepods(/[^/]+)*/pod[^/]+/.+";
export const BUILDKITE_POD_LIFETIME_WRITES_SEEN_24H_BUDGET_BYTES = 4_398_046_511_104;
export const BUILDKITE_POD_LIFETIME_WRITES_SEEN_24H_METRIC =
  "woodpecker:pod_parent_fs_writes_bytes:pod_lifetime_max_seen_24h";
export const BUILDKITE_POD_PARENT_FS_WRITES_BYTES_BY_JOB_METRIC =
  "woodpecker:pod_parent_fs_writes_bytes_by_job_total";
export const BUILDKITE_BUN_CACHE_PVC = "woodpecker-bun-cache";
export const BUILDKITE_BUN_CACHE_GC_ACTIVITY = "woodpecker-bun-cache-gc";
export const TURBO_CACHE_CLEAN_ACTIVITY = "turbo-cache-clean";

function maintenanceWorkerStaleExpression(
  maintenanceJob: string,
  maximumAgeSeconds: number,
): string {
  return `
or (
  absent(
    kubernetes_maintenance_last_success_timestamp_seconds{
      maintenance_job="${maintenanceJob}"
    }
  )
  and on() (
    time() - max(
      temporal_worker_app_process_start_time_seconds{
        namespace="woodpecker",
        pod=~"temporal-maintenance-worker-.*"
      }
    ) > ${String(maximumAgeSeconds)}
    or time() - max(
      kube_pod_start_time{
        namespace="woodpecker",
        pod=~"temporal-maintenance-worker-.*"
      }
    ) > ${String(maximumAgeSeconds)}
    or on() (
      kube_deployment_status_condition{
        namespace="woodpecker",
        deployment="temporal-maintenance-worker",
        condition="Progressing",
        status="false"
      } == 1
      or on() (
        kube_deployment_status_condition{
          namespace="woodpecker",
          deployment="temporal-maintenance-worker",
          condition="Progressing",
          status="true",
          reason="NewReplicaSetAvailable"
        } == 1
        and on() (
          absent(
            kube_deployment_status_replicas_available{
              namespace="woodpecker",
              deployment="temporal-maintenance-worker"
            }
          )
          or max(
            kube_deployment_status_replicas_available{
              namespace="woodpecker",
              deployment="temporal-maintenance-worker"
            }
          ) == 0
          or absent(
            up{
              namespace="woodpecker",
              service="temporal-maintenance-worker-app-metrics"
            }
          )
        )
      )
    )
  )
)`;
}

const MAINTENANCE_WORKER_STALE_EXPRESSION = maintenanceWorkerStaleExpression(
  BUILDKITE_BUN_CACHE_GC_ACTIVITY,
  1200,
);

const MAINTENANCE_STALE_EXPRESSION = `(
  time() - kubernetes_maintenance_last_success_timestamp_seconds{
    maintenance_job="${BUILDKITE_BUN_CACHE_GC_ACTIVITY}"
  } > 1200
)
${MAINTENANCE_WORKER_STALE_EXPRESSION}`;

const TURBO_CACHE_CLEAN_STALE_EXPRESSION = `(
  time() - kubernetes_maintenance_last_success_timestamp_seconds{
    maintenance_job="${TURBO_CACHE_CLEAN_ACTIVITY}"
  } > 129600
)
${maintenanceWorkerStaleExpression(TURBO_CACHE_CLEAN_ACTIVITY, 129_600)}`;

const POD_LABEL_METADATA = [
  "label_woodpecker_com_job_uuid",
  "label_ci_sjer_red_step_key",
].join(", ");

const POD_ANNOTATION_METADATA = [
  "annotation_woodpecker_com_build_branch",
  "annotation_woodpecker_com_build_url",
  "annotation_woodpecker_com_job_url",
  "annotation_woodpecker_com_pipeline_slug",
].join(", ");

function woodpeckerPodLabels(): string {
  // Defensively drop scrape-target labels before arithmetic joins so each
  // namespace/pod/metadata tuple stays unique if scrape topology changes.
  return `max by (namespace, pod, ${POD_LABEL_METADATA}) (
  kube_pod_labels{namespace="woodpecker", label_woodpecker_com_job_uuid!=""}
)`;
}

function woodpeckerPodAnnotations(): string {
  return `max by (namespace, pod, ${POD_ANNOTATION_METADATA}) (
  kube_pod_annotations{namespace="woodpecker", annotation_woodpecker_com_job_url!=""}
)`;
}

function withWoodpeckerPodMetadata(expression: string): string {
  return `(
  ${expression}
)
* on (namespace, pod) group_left(${POD_LABEL_METADATA})
  ${woodpeckerPodLabels()}
* on (namespace, pod) group_left(${POD_ANNOTATION_METADATA})
  ${woodpeckerPodAnnotations()}`;
}

function podParentCounter(metric: string): string {
  return `max by (namespace, pod, node, device) (
    ${metric}{
      namespace="woodpecker",
      pod=~"${BUILDKITE_JOB_POD_PATTERN}",
      container="",
      id=~"${BUILDKITE_POD_PARENT_CGROUP_PATTERN}"
    }
  )`;
}

function attributedPodParentCounter(metric: string): string {
  return withWoodpeckerPodMetadata(podParentCounter(metric));
}

function containerCounter(metric: string): string {
  return withWoodpeckerPodMetadata(
    `max by (namespace, pod, node, container, device) (
    ${metric}{
      namespace="woodpecker",
      pod=~"${BUILDKITE_JOB_POD_PATTERN}",
      container!="",
      container!="POD",
      id=~"${BUILDKITE_POD_CHILD_CGROUP_PATTERN}"
    }
  )`,
  );
}

function woodpeckerBunCacheUsageRatio(): string {
  // kubelet_volume_stats metrics disappear whenever no pod mounts the PVC.
  // Join the always-on ZFS dataset telemetry to kube-state-metrics so the
  // alert remains present between Woodpecker jobs and stays scoped to this PVC.
  return `label_replace(
  max by (node, dataset_name) (
    zfs_dataset_used_bytes{
      node="liskov",
      dataset_name=~".*/pvc-.*"
    }
    /
    (
      zfs_dataset_used_bytes{
        node="liskov",
        dataset_name=~".*/pvc-.*"
      }
      +
      zfs_dataset_available_bytes{
        node="liskov",
        dataset_name=~".*/pvc-.*"
      }
    )
  ),
  "volumename",
  "$1",
  "dataset_name",
  ".*/(pvc-.*)"
)
* on (volumename) group_left(namespace, persistentvolumeclaim)
max by (volumename, namespace, persistentvolumeclaim) (
  kube_persistentvolumeclaim_info{
    namespace="woodpecker",
    persistentvolumeclaim="${BUILDKITE_BUN_CACHE_PVC}"
  }
)`;
}

export function getWoodpeckerRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "woodpecker-ci-io-recording",
      interval: "10s",
      rules: [
        {
          record: "woodpecker:pod_parent_fs_writes_bytes_total",
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
          record: "woodpecker:pod_parent_fs_reads_bytes_total",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            podParentCounter("container_fs_reads_bytes_total"),
          ),
        },
        {
          record: "woodpecker:pod_parent_fs_writes_total",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            podParentCounter("container_fs_writes_total"),
          ),
        },
        {
          record: "woodpecker:pod_parent_fs_reads_total",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            podParentCounter("container_fs_reads_total"),
          ),
        },
        {
          record: "woodpecker:pod_parent_io_waiting_seconds_total",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            podParentCounter("container_pressure_io_waiting_seconds_total"),
          ),
        },
        {
          record: "woodpecker:pod_parent_io_stalled_seconds_total",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            podParentCounter("container_pressure_io_stalled_seconds_total"),
          ),
        },
        {
          record: "woodpecker:container_fs_writes_bytes_total",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            containerCounter("container_fs_writes_bytes_total"),
          ),
        },
        {
          record: "woodpecker:container_fs_reads_bytes_total",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            containerCounter("container_fs_reads_bytes_total"),
          ),
        },
        {
          record: "woodpecker:pod_parent_sample_present",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `${BUILDKITE_POD_PARENT_FS_WRITES_BYTES_BY_JOB_METRIC} * 0 + 1`,
          ),
        },
      ],
    },
    {
      name: "woodpecker-ci-io-rollups",
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
            "sum(max_over_time(woodpecker:pod_parent_fs_writes_bytes_total[24h]))",
          ),
        },
      ],
    },
    {
      name: "woodpecker-ci-io-alerts",
      interval: "30s",
      rules: [
        {
          alert: "WoodpeckerCIIOTelemetryMissing",
          annotations: {
            summary:
              "A running Woodpecker job pod has no attributed parent-cgroup I/O samples",
            description: escapePrometheusTemplate(
              "Woodpecker pod {{ $labels.pod }} has been running for more than one minute without a unique, metadata-attributed pod-parent filesystem sample.",
            ),
          },
          // Select the running cohort from the pod name itself. Requiring
          // kube_pod_labels here would make a pod with missing KSM metadata
          // invisible to the alert that is intended to detect that gap.
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(`
  max by (namespace, pod) (
    kube_pod_status_phase{
      namespace="woodpecker",
      pod=~"${BUILDKITE_JOB_POD_PATTERN}",
      phase="Running"
    } == 1
  )
unless on (namespace, pod)
  woodpecker:pod_parent_sample_present`),
          for: "1m",
          labels: {
            severity: "info",
            category: "ci",
          },
        },
        {
          alert: "WoodpeckerCIPodLifetimeWritesSeen24hBudgetExceeded",
          annotations: {
            summary:
              "Woodpecker pod-lifetime writes seen in 24 hours exceeded the rounded operational budget",
            description: escapePrometheusTemplate(
              "Woodpecker pod/device lifetime maxima seen in the last 24 hours total {{ $value | humanize1024 }}B. Pods crossing the left boundary include earlier writes, and completed pods remain until their last sample ages out. This conservative cohort value is not an exact 24-hour write delta. The rounded 4 TiB operational guardrail across every node running CI is separate from the reporter's exact fixed-corpus 50% acceptance gate.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `${BUILDKITE_POD_LIFETIME_WRITES_SEEN_24H_METRIC} > ${String(BUILDKITE_POD_LIFETIME_WRITES_SEEN_24H_BUDGET_BYTES)}`,
          ),
          for: "30m",
          labels: {
            severity: "info",
            category: "ci",
            namespace: "woodpecker",
          },
        },
        {
          alert: "WoodpeckerControllerMetricsMissing",
          annotations: {
            summary: "Woodpecker controller metrics are missing or unhealthy",
            description:
              "The Woodpecker controller is available, but its monitor health metric has been absent or reported unhealthy for five minutes.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(`(
  sum(kube_deployment_status_replicas_available{
    namespace="woodpecker",
    deployment="woodpecker-agent-stack-k8s"
  }) > 0
)
and on ()
  (
    absent(woodpecker_monitor_monitor_up{namespace="woodpecker"})
    or on ()
    max(woodpecker_monitor_monitor_up{namespace="woodpecker"}) == 0
  )`),
          for: "5m",
          labels: {
            severity: "info",
            category: "ci",
            namespace: "woodpecker",
          },
        },
        {
          alert: "WoodpeckerBunCacheUsageHigh",
          annotations: {
            summary: "Woodpecker Bun cache is more than 75% full",
            description: escapePrometheusTemplate(
              "The shared Woodpecker Bun cache PVC {{ $labels.persistentvolumeclaim }} is {{ $value | humanizePercentage }} full. The collector should clear it at 60%; investigate collector health and lock contention.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(${woodpeckerBunCacheUsageRatio()}) > 0.75`,
          ),
          for: "10m",
          labels: {
            severity: "warning",
            category: "ci",
            namespace: "woodpecker",
          },
        },
        {
          alert: "WoodpeckerBunCacheUsageCritical",
          annotations: {
            summary: "Woodpecker Bun cache is more than 90% full",
            description: escapePrometheusTemplate(
              "The shared Woodpecker Bun cache PVC {{ $labels.persistentvolumeclaim }} is {{ $value | humanizePercentage }} full and approaching install failure.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(${woodpeckerBunCacheUsageRatio()}) > 0.9`,
          ),
          for: "5m",
          labels: {
            severity: "critical",
            category: "ci",
            namespace: "woodpecker",
          },
        },
        {
          alert: "WoodpeckerBunCacheCollectorStale",
          annotations: {
            summary:
              "Woodpecker Bun cache maintenance activity is missing or has not succeeded",
            description:
              "The five-minute Woodpecker Bun cache maintenance activity has not completed successfully in the last 20 minutes.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            MAINTENANCE_STALE_EXPRESSION,
          ),
          for: "1m",
          labels: {
            severity: "warning",
            category: "ci",
            namespace: "woodpecker",
          },
        },
        {
          alert: "TurboCacheCleanupStale",
          annotations: {
            summary: "Turbo cache cleanup has not succeeded in 36 hours",
            description:
              "The daily authenticated Turbo cache cleanup has not completed successfully in the last 36 hours.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            TURBO_CACHE_CLEAN_STALE_EXPRESSION,
          ),
          for: "1m",
          labels: {
            severity: "warning",
            category: "ci",
            namespace: "turbo-cache",
          },
        },
      ],
    },
  ];
}
