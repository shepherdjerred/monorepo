import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";

const CLAIMS =
  'max by (namespace, pod, persistentvolumeclaim) (kube_pod_spec_volumes_persistentvolumeclaims_info{persistentvolumeclaim!=""})';
// Ambiguous pods or claims cannot justify suppressing the generic forecast.
const UNIQUE_CLAIMS = `(${CLAIMS}) and on(namespace,pod) (count by(namespace,pod) (${CLAIMS}) == 1) and on(namespace,persistentvolumeclaim) (count by(namespace,persistentvolumeclaim) (${CLAIMS}) == 1)`;
function tsdb(metric: string): string {
  return `max by(namespace,persistentvolumeclaim) (max by(namespace,pod) (${metric}) * on(namespace,pod) group_left(persistentvolumeclaim) (${UNIQUE_CLAIMS}))`;
}
const BLOCKS = tsdb("prometheus_tsdb_storage_blocks_bytes");
const CAP = tsdb("prometheus_tsdb_retention_limit_bytes");
const USED =
  "max by(namespace,persistentvolumeclaim) (kubelet_volume_stats_used_bytes)";
const CAPACITY =
  "max by(namespace,persistentvolumeclaim) (kubelet_volume_stats_capacity_bytes)";
const NON_BLOCKS = `clamp_min((${USED}) - (${BLOCKS}), 0)`;

// A distinct temporary label preserves every operand through the union;
// `a or b` with identical labels would silently drop b before min/max.
function extrema(kind: "min" | "max", values: readonly string[]): string {
  return `${kind} by(namespace,persistentvolumeclaim) (${values.map((value, index) => `label_replace((${value}), "forecast_operand", "${String(index)}", "namespace", ".*")`).join(" or ")})`;
}

export function prometheusForecastExpression(days: number): string {
  const horizon = String(days * 86_400);
  const blocks = extrema("min", [
    CAP,
    `(${BLOCKS}) + clamp_min(deriv((${BLOCKS})[7d:1h]), 0) * ${horizon}`,
  ]);
  const nonBlocks = extrema("max", [
    NON_BLOCKS,
    `max_over_time((${NON_BLOCKS})[30d:1h])`,
    `(${NON_BLOCKS}) + clamp_min(deriv((${NON_BLOCKS})[7d:1h]), 0) * ${horizon}`,
    `(${CAPACITY}) * 0.20`,
  ]);
  // Retention can temporarily overshoot during compaction. Until current
  // blocks return within the cap, retain the generic PVC growth forecast.
  return `((${blocks}) + (${nonBlocks}))
    and on(namespace,persistentvolumeclaim) ((${CAP}) > 0)
    and on(namespace,persistentvolumeclaim) ((${BLOCKS}) <= (${CAP}))
    and on(namespace,persistentvolumeclaim) ((${CAP}) <= (${CAPACITY}) * 0.80)
    and on(namespace,persistentvolumeclaim) (${tsdb("timestamp(prometheus_tsdb_retention_limit_bytes)")} > time() - 600)
    and on(namespace,persistentvolumeclaim) (count_over_time((${BLOCKS})[7d:1h]) >= 160)
    and on(namespace,persistentvolumeclaim) last_over_time((${BLOCKS})[1h:1h] offset 7d)
    and on(namespace,persistentvolumeclaim) (count_over_time((${NON_BLOCKS})[30d:1h]) >= 684)
    and on(namespace,persistentvolumeclaim) last_over_time((${NON_BLOCKS})[1h:1h] offset 30d)`;
}

/** Retention caps blocks only; WAL/head/compaction reserve remains uncapped. */
export function getPrometheusStorageForecastRuleGroup(): PrometheusRuleSpecGroups {
  return {
    name: "prometheus-storage-forecast",
    interval: "5m",
    rules: [14, 60].map((days) => ({
      record: `homelab:prometheus_pvc_forecast_bytes:${String(days)}d`,
      expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
        prometheusForecastExpression(days),
      ),
    })),
  };
}
