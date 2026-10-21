/**
 * Chart ids for the cluster baseline: objects the root chart renders today and
 * the v2 cutover charts mirror object-for-object while the root keeps
 * rendering them. The root chart namespace is `argocd`; every mirrored object
 * keeps that namespace so cluster-scoped manifests stay byte-identical.
 */
export const ROOT_CHART = "apps";
export const CLUSTER_ADMISSION_CHART = "cluster-admission";
export const CLUSTER_PLATFORM_CHART = "cluster-platform";
export const CLUSTER_OBSERVABILITY_CHART = "cluster-observability";
export const BASELINE_CHART_NAMESPACE = "argocd";

/** Charts whose non-Application resources carry the root's sync-wave policy. */
export const BASELINE_CHARTS: ReadonlySet<string> = new Set([
  ROOT_CHART,
  CLUSTER_ADMISSION_CHART,
  CLUSTER_PLATFORM_CHART,
  CLUSTER_OBSERVABILITY_CHART,
]);

/**
 * The baseline charts. The root renders no Application for them: Delivery
 * creates `cluster-platform` and `cluster-observability`, and the operator
 * `cluster-admission`, at the window's ownership flip, while the retained root
 * still renders the same objects.
 */
export const BASELINE_CHART_APPLICATIONS = [
  CLUSTER_ADMISSION_CHART,
  CLUSTER_PLATFORM_CHART,
  CLUSTER_OBSERVABILITY_CHART,
] as const;
