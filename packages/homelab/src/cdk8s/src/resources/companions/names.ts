/**
 * Upstream-chart Applications whose constructors also render objects into the
 * root chart: Ingresses, TunnelBindings, OnePasswordItems, volume claims,
 * Velero Schedules and the like. Under one Application per environment the
 * upstream chart cannot carry them, so each gets a first-party companion chart
 * that its service deploys before the upstream Application (Delivery model,
 * section 7). Dependency-free so the release policy can name the charts.
 */
export const COMPANION_APPLICATIONS = [
  "argocd",
  "tailscale",
  "prometheus",
  "cloudflare-operator",
  "chartmuseum",
  "minecraft-sjerred",
  "minecraft-shuxin",
  "minecraft-tsmc",
  "loki",
  "tempo",
  "pyroscope",
  "alloy-gateway",
  "velero",
  "seaweedfs",
] as const;
export type CompanionApplication = (typeof COMPANION_APPLICATIONS)[number];

export function companionChartName(application: CompanionApplication): string {
  return `${application}-companion`;
}

/**
 * Custom resources of an upstream chart's own CRDs deploy after the upstream
 * Application, from a following chart its service deploys; a leading
 * companion, if any, keeps only what the upstream needs before it starts.
 * - Velero's Schedules need its CRDs; its cloud credentials come first.
 * - Kueue's flavors, priority classes and queues need its CRDs, and its
 *   controller needs the platform's PriorityClass, so they leave
 *   cluster-platform for the kueue environment.
 * - ArgoCD's TunnelBinding needs cloudflare-operator's CRDs, and ArgoCD
 *   precedes every other Application environment, so the operator's
 *   environment deploys it.
 */
export const FOLLOWING_COMPANIONS: Readonly<Record<string, string>> = {
  velero: "velero-schedules",
  kueue: "kueue-queues",
  "cloudflare-operator": "argocd-tunnel",
};

/** Chart ids of the companion charts, leading and following; each renders only under transition rendering. */
export const COMPANION_CHARTS: ReadonlySet<string> = new Set([
  ...COMPANION_APPLICATIONS.map((application) =>
    companionChartName(application),
  ),
  ...Object.values(FOLLOWING_COMPANIONS),
]);
