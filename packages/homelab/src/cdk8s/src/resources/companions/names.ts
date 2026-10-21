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

/** Chart ids of the companion charts; each renders only under transition rendering. */
export const COMPANION_CHARTS: ReadonlySet<string> = new Set(
  COMPANION_APPLICATIONS.map((application) => companionChartName(application)),
);
