import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

/**
 * Pod names Woodpecker's Kubernetes backend generates for clone and step pods.
 *
 * `wp-<ULID>`: the step's ULID, lowercased (v3.18.1 `podName`). Crockford
 * base32 rather than a UUID. Service pods are `wp-svc-<ULID>-<name>` and do
 * not match. Matching on the name is what scopes every rule below to CI work
 * and excludes the maintenance worker, which shares the CI namespace.
 */
export const CI_JOB_POD_PATTERN = "wp-[0-9a-hjkmnp-tv-z]{26}";
export const CI_POD_PARENT_CGROUP_PATTERN = "/kubepods(/[^/]+)*/pod[^/]+";
export const CI_POD_CHILD_CGROUP_PATTERN = "/kubepods(/[^/]+)*/pod[^/]+/.+";
export const CI_POD_LIFETIME_WRITES_SEEN_24H_BUDGET_BYTES = 4_398_046_511_104;
export const CI_POD_LIFETIME_WRITES_SEEN_24H_METRIC =
  "woodpecker:pod_parent_fs_writes_bytes:pod_lifetime_max_seen_24h";
export const CI_POD_PARENT_FS_WRITES_BYTES_BY_JOB_METRIC =
  "woodpecker:pod_parent_fs_writes_bytes_by_job_total";
export const CI_BUN_CACHE_PVC = "woodpecker-bun-cache";
/**
 * `maintenance_job` label on the Bun cache collector's metrics.
 *
 * This is the Temporal Schedule id and the MaintenanceKind literal in
 * packages/temporal/src/activities/maintenance/maintenance.ts -- the same
 * string in three places, because the metric label is produced there and
 * matched here. A rename in one is an alert that watches a job nothing
 * reports.
 */
export const CI_BUN_CACHE_GC_ACTIVITY = "ci-bun-cache-gc";

/**
 * How old a per-workflow workspace claim may get before it is a leak.
 *
 * Woodpecker deletes the claim when its workflow ends, and no workflow outlives
 * its 270-minute timeout; six hours is comfortably past both. A leak is a
 * Woodpecker cleanup failure (its teardown stops at the first error, before the
 * claim), and each one holds space on the CI pool until the CI workspace reaper
 * deletes it. The reaper selects leaks by the same age
 * (CI_WORKSPACE_LEAK_AGE_SECONDS in
 * packages/temporal/src/activities/maintenance/ci-workspace-reaper.ts).
 */
export const CI_WORKSPACE_LEAK_AGE_SECONDS = 6 * 60 * 60;

/**
 * How long past the leak age the leak alert waits for the reaper.
 *
 * `runCiWorkspaceReaperWorkflow` runs every 15 minutes, and the infra queue it
 * runs on executes one Activity at a time, for at most 45 minutes. A claim two
 * hours past the leak age means the reaper itself is failing or paused.
 */
export const CI_WORKSPACE_REAPER_GRACE_SECONDS = 2 * 60 * 60;

/**
 * `maintenance_job` label on the CI workspace reaper's success metric
 * (CI_WORKSPACE_REAP_ACTIVITY in ci-workspace-reaper.ts).
 */
export const CI_WORKSPACE_REAP_ACTIVITY = "ci-workspace-reap";
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
        namespace="woodpecker-ci",
        pod=~"temporal-maintenance-worker-.*"
      }
    ) > ${String(maximumAgeSeconds)}
    or time() - max(
      kube_pod_start_time{
        namespace="woodpecker-ci",
        pod=~"temporal-maintenance-worker-.*"
      }
    ) > ${String(maximumAgeSeconds)}
    or on() (
      kube_deployment_status_condition{
        namespace="woodpecker-ci",
        deployment="temporal-maintenance-worker",
        condition="Progressing",
        status="false"
      } == 1
      or on() (
        kube_deployment_status_condition{
          namespace="woodpecker-ci",
          deployment="temporal-maintenance-worker",
          condition="Progressing",
          status="true",
          reason="NewReplicaSetAvailable"
        } == 1
        and on() (
          absent(
            kube_deployment_status_replicas_available{
              namespace="woodpecker-ci",
              deployment="temporal-maintenance-worker"
            }
          )
          or max(
            kube_deployment_status_replicas_available{
              namespace="woodpecker-ci",
              deployment="temporal-maintenance-worker"
            }
          ) == 0
          or absent(
            up{
              namespace="woodpecker-ci",
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
  CI_BUN_CACHE_GC_ACTIVITY,
  1200,
);

const MAINTENANCE_STALE_EXPRESSION = `(
  time() - kubernetes_maintenance_last_success_timestamp_seconds{
    maintenance_job="${CI_BUN_CACHE_GC_ACTIVITY}"
  } > 1200
)
${MAINTENANCE_WORKER_STALE_EXPRESSION}`;

const TURBO_CACHE_CLEAN_STALE_EXPRESSION = `(
  time() - kubernetes_maintenance_last_success_timestamp_seconds{
    maintenance_job="${TURBO_CACHE_CLEAN_ACTIVITY}"
  } > 129600
)
${maintenanceWorkerStaleExpression(TURBO_CACHE_CLEAN_ACTIVITY, 129_600)}`;

/**
 * Pod metadata the generated pipeline stamps, flattened as kube-state-metrics
 * exposes it.
 *
 * Woodpecker itself stamps nothing identifying: its pod names carry a ULID and
 * a step index, not a step key. So the configuration extension writes these
 * through `backend_options.kubernetes.labels` / `.annotations` -- see
 * POD_STEP_KEY_LABEL and friends in
 * packages/woodpecker-config-extension/src/pipeline/emit.ts, which is the
 * authority on the un-flattened spelling, and the kube-state-metrics allowlist
 * in ../../../argo-applications/observability/grafana-values.ts, which decides
 * which of them are exported at all. All three must agree or these joins
 * silently produce nothing.
 *
 * Commit plus step key identifies one CI step run. It is not quite unique
 * -- a retry of the same step on the same commit shares it -- and the
 * reporter's integrity check is what turns that into a loud failure rather
 * than misattributed bytes.
 */
const POD_LABEL_METADATA = [
  "label_ci_sjer_red_commit",
  "label_ci_sjer_red_step_key",
].join(", ");

const POD_ANNOTATION_METADATA = [
  "annotation_ci_sjer_red_branch",
  "annotation_ci_sjer_red_pipeline_url",
].join(", ");

function woodpeckerPodLabels(): string {
  // Defensively drop scrape-target labels before arithmetic joins so each
  // namespace/pod/metadata tuple stays unique if scrape topology changes.
  return `max by (namespace, pod, ${POD_LABEL_METADATA}) (
  kube_pod_labels{namespace="woodpecker-ci", label_ci_sjer_red_step_key!=""}
)`;
}

function woodpeckerPodAnnotations(): string {
  return `max by (namespace, pod, ${POD_ANNOTATION_METADATA}) (
  kube_pod_annotations{namespace="woodpecker-ci", annotation_ci_sjer_red_pipeline_url!=""}
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
      namespace="woodpecker-ci",
      pod=~"${CI_JOB_POD_PATTERN}",
      container="",
      id=~"${CI_POD_PARENT_CGROUP_PATTERN}"
    }
  )`;
}

function attributedPodParentCounter(metric: string): string {
  return withWoodpeckerPodMetadata(podParentCounter(metric));
}

function podParentPresence(): string {
  // Linux cgroupv2 (io.stat) emits no container_fs_writes_bytes_total series
  // until a cgroup performs its first physical block-device write, so zero-write
  // steps like codex-review-gate never appear in block I/O counters. Parent-cgroup
  // CPU telemetry exists from pod start and joins the same KSM metadata.
  return `(
  ${withWoodpeckerPodMetadata(
    `max by (namespace, pod, node) (
    container_cpu_usage_seconds_total{
      namespace="woodpecker-ci",
      pod=~"${CI_JOB_POD_PATTERN}",
      container="",
      id=~"${CI_POD_PARENT_CGROUP_PATTERN}"
    }
  )`,
  )}
) * 0 + 1`;
}

function containerCounter(metric: string): string {
  return withWoodpeckerPodMetadata(
    `max by (namespace, pod, node, container, device) (
    ${metric}{
      namespace="woodpecker-ci",
      pod=~"${CI_JOB_POD_PATTERN}",
      container!="",
      container!="POD",
      id=~"${CI_POD_CHILD_CGROUP_PATTERN}"
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
    namespace="woodpecker-ci",
    persistentvolumeclaim="${CI_BUN_CACHE_PVC}"
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
          record: CI_POD_PARENT_FS_WRITES_BYTES_BY_JOB_METRIC,
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
            podParentPresence(),
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
          record: CI_POD_LIFETIME_WRITES_SEEN_24H_METRIC,
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
            summary: "CI job pod is missing disk I/O metrics",
            description: escapePrometheusTemplate(
              "Running Woodpecker CI pod {{ $labels.pod }} has been active for over 1 minute without attributed pod-level telemetry, leaving per-step CI disk I/O accounting incomplete. Check kube-state-metrics label and annotation allowlists and cAdvisor cgroup metrics on the CI node.",
            ),
          },
          // Select the running cohort from the pod name itself. Requiring
          // kube_pod_labels here would make a pod with missing KSM metadata
          // invisible to the alert that is intended to detect that gap.
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(`
  max by (namespace, pod) (
    kube_pod_status_phase{
      namespace="woodpecker-ci",
      pod=~"${CI_JOB_POD_PATTERN}",
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
          // Conservative cohort guardrail: pods crossing the left 24h boundary
          // include earlier writes, and completed pods remain until their last
          // sample ages out, so this is not an exact 24-hour write delta. The
          // rounded 4 TiB operational guardrail across every CI node is
          // separate from the reporter's exact fixed-corpus 50% acceptance gate.
          alert: "WoodpeckerCIPodLifetimeWritesSeen24hBudgetExceeded",
          annotations: {
            summary:
              "Woodpecker CI 24-hour disk write volume exceeded 4 TiB budget",
            description: escapePrometheusTemplate(
              "Woodpecker CI pods seen in the last 24 hours wrote {{ $value | humanize1024 }}B cumulatively, exceeding the 4 TiB operational SSD wear guardrail. Inspect disk writes by CI step key in Grafana to identify noisy steps or broken caches.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `${CI_POD_LIFETIME_WRITES_SEEN_24H_METRIC} > ${String(CI_POD_LIFETIME_WRITES_SEEN_24H_BUDGET_BYTES)}`,
          ),
          for: "30m",
          labels: {
            severity: "info",
            category: "ci",
            namespace: "woodpecker-ci",
          },
        },
        {
          // The agent is a plain Deployment holding a gRPC stream to the
          // server, so the health question is whether an available agent is
          // actually connected to the server.
          alert: "WoodpeckerAgentDisconnected",
          annotations: {
            summary:
              "Woodpecker CI agents are running but disconnected from server",
            description:
              "Woodpecker agent pods are running, but the server has reported zero connected agents for 5 minutes, leaving CI pipelines stuck in queue. Check woodpecker-agent and woodpecker-server logs for gRPC connectivity or authentication errors.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(`(
  sum(kube_deployment_status_replicas_available{
    namespace="woodpecker",
    deployment="woodpecker-agent"
  }) > 0
)
and on ()
  (
    absent(woodpecker_worker_count{namespace="woodpecker"})
    or on ()
    max(woodpecker_worker_count{namespace="woodpecker"}) == 0
  )`),
          for: "5m",
          labels: {
            severity: "info",
            category: "ci",
            namespace: "woodpecker",
          },
        },
        {
          // Bun cache GC prunes at 60% usage; crossing 75% means GC is falling
          // behind or blocked by active job locks.
          alert: "WoodpeckerBunCacheUsageHigh",
          annotations: {
            summary: "Woodpecker Bun cache volume is over 75% full",
            description: escapePrometheusTemplate(
              "Shared Woodpecker Bun cache PVC {{ $labels.persistentvolumeclaim }} is {{ $value | humanizePercentage }} full, risking disk exhaustion during CI installs if growth continues. Check the ci-bun-cache-gc maintenance schedule and inspect for lock contention from long-running CI jobs.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(${woodpeckerBunCacheUsageRatio()}) > 0.75`,
          ),
          for: "10m",
          labels: {
            severity: "warning",
            category: "ci",
            namespace: "woodpecker-ci",
          },
        },
        {
          alert: "WoodpeckerBunCacheUsageCritical",
          annotations: {
            summary: "Woodpecker Bun cache volume is over 90% full",
            description: escapePrometheusTemplate(
              "Shared Woodpecker Bun cache PVC {{ $labels.persistentvolumeclaim }} is {{ $value | humanizePercentage }} full and about to fail CI dependency installs with out-of-space errors. Run or unblock the ci-bun-cache-gc workflow immediately and inspect ZFS dataset usage on liskov.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `(${woodpeckerBunCacheUsageRatio()}) > 0.9`,
          ),
          for: "5m",
          labels: {
            severity: "critical",
            category: "ci",
            namespace: "woodpecker-ci",
          },
        },
        {
          alert: "WoodpeckerWorkspaceClaimLeaked",
          annotations: {
            summary: "Old CI workspace volume was not cleaned up",
            description: escapePrometheusTemplate(
              "CI workspace PVC {{ $labels.persistentvolumeclaim }} has outlived both the maximum workflow timeout and the reaper grace window, consuming storage on the CI ZFS pool. Check the ci-workspace-reaper Temporal schedule and inspect whether a stuck non-terminal pod still mounts the claim.",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(`(
  time() - max by (namespace, persistentvolumeclaim) (
    kube_persistentvolumeclaim_created{namespace="woodpecker-ci"}
  )
) > ${String(CI_WORKSPACE_LEAK_AGE_SECONDS + CI_WORKSPACE_REAPER_GRACE_SECONDS)}
and on (namespace, persistentvolumeclaim)
  max by (namespace, persistentvolumeclaim) (
    kube_persistentvolumeclaim_info{
      namespace="woodpecker-ci",
      storageclass="ci-workspace"
    }
  )`),
          for: "10m",
          labels: {
            severity: "warning",
            category: "ci",
            namespace: "woodpecker-ci",
          },
        },
        {
          // A paused schedule, or a restarted worker that has not run it yet,
          // reports no metric and does not fire this alert;
          // WoodpeckerWorkspaceClaimLeaked covers any resulting leaked claims.
          alert: "WoodpeckerWorkspaceReaperStale",
          annotations: {
            summary:
              "Woodpecker CI workspace reaper has not succeeded in 1 hour",
            description:
              "The CI workspace reaper workflow has not completed a successful cleanup run in the last hour, allowing leaked CI pods and workspace PVCs to accumulate disk usage. Check the ci-workspace-reaper schedule in the Temporal UI and inspect the infra worker logs.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `time() - max(kubernetes_maintenance_last_success_timestamp_seconds{maintenance_job="${CI_WORKSPACE_REAP_ACTIVITY}"}) > 3600`,
          ),
          for: "15m",
          labels: {
            severity: "warning",
            category: "ci",
            namespace: "woodpecker-ci",
          },
        },
        {
          alert: "WoodpeckerBunCacheCollectorStale",
          annotations: {
            summary: "Woodpecker Bun cache cleanup has stalled",
            description:
              "The Woodpecker Bun cache garbage-collection job has not succeeded in the last 20 minutes, allowing the shared Bun cache volume to fill unchecked. Check the temporal-maintenance-worker deployment in woodpecker-ci and the ci-bun-cache-gc schedule in the Temporal UI.",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            MAINTENANCE_STALE_EXPRESSION,
          ),
          for: "1m",
          labels: {
            severity: "warning",
            category: "ci",
            namespace: "woodpecker-ci",
          },
        },
        {
          alert: "TurboCacheCleanupStale",
          annotations: {
            summary: "Turborepo cache cleanup has not succeeded in 36 hours",
            description:
              "The daily Turborepo cache cleanup job has not succeeded in 36 hours, risking unbounded cache storage growth. Check the turbo-cache-clean schedule in the Temporal UI and inspect the temporal-maintenance-worker logs in woodpecker-ci.",
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
