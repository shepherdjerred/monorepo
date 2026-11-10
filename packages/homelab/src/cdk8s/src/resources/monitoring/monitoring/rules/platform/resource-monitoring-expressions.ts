import { WOODPECKER_CI_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts";
import { WOODPECKER_UV_CACHE_CLAIM } from "@shepherdjerred/homelab/cdk8s/src/resources/woodpecker/caches.ts";

export const memoryLeakExpression = [
  "((node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) - on(instance) ",
  "group_left node_zfs_arc_size) - ((node_memory_MemTotal_bytes offset 24h - ",
  "node_memory_MemAvailable_bytes offset 24h) - on(instance) group_left ",
  "node_zfs_arc_size offset 24h) > 8589934592",
].join("");

/**
 * Claims a scheduled prune empties on a fixed cadence. Between prunes the
 * claim only grows, so a seven-day `deriv` sees the rising edge and projects
 * a fill that the next prune always prevents. Each entry names the schedule
 * that bounds it; a claim belongs here only while that schedule exists.
 * Absolute usage still alerts through PVCStorageHigh and ZfsPVCStorageHigh.
 */
export const PERIODICALLY_PRUNED_PVCS = [
  {
    namespace: WOODPECKER_CI_NAMESPACE,
    claim: WOODPECKER_UV_CACHE_CLAIM,
    // packages/temporal/src/schedules/schedule-definitions.ts
    prunedBy: "ci-uv-cache-prune-weekly",
  },
] as const;

function periodicallyPrunedClaimSelector(): string {
  return PERIODICALLY_PRUNED_PVCS.map(
    ({ namespace, claim }) =>
      `kubelet_volume_stats_used_bytes{namespace="${namespace}",persistentvolumeclaim="${claim}"}`,
  ).join(" or ");
}

export function pvcProjectedFullExpression(days: number): string {
  const seconds = days * 24 * 60 * 60;
  return `(
  kubelet_volume_stats_available_bytes
  /
  deriv(kubelet_volume_stats_used_bytes[7d])
) < ${String(seconds)}
and on (namespace, persistentvolumeclaim)
deriv(kubelet_volume_stats_used_bytes[7d]) > 0
and on (namespace, persistentvolumeclaim) kubelet_volume_stats_used_bytes offset 7d
unless on(namespace,persistentvolumeclaim)
(homelab:prometheus_pvc_forecast_bytes:${String(days)}d <= on(namespace,persistentvolumeclaim) max by(namespace,persistentvolumeclaim) (kubelet_volume_stats_capacity_bytes))
unless on(namespace,persistentvolumeclaim)
(${periodicallyPrunedClaimSelector()})`;
}
