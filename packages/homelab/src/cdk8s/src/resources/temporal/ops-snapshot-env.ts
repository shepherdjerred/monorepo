import { EnvValue, type ISecret } from "cdk8s-plus-31";

/**
 * Environment for the ops-snapshot collector and digest trigger on the infra
 * worker. The URLs are in-cluster bootstrap addresses; the three credentials
 * are required fields of the Temporal worker 1Password item. Prometheus,
 * Bugsink, Buildkite, GitHub App, and talosconfig access come from the
 * homelab-audit environment the infra worker already carries.
 */
export function opsSnapshotEnv(secret: ISecret): Record<string, EnvValue> {
  return {
    OPS_DASHBOARD_URL: EnvValue.fromValue(
      "http://alert-dashboard-alert-dashboard-service.alert-dashboard:7341",
    ),
    ALERTMANAGER_URL: EnvValue.fromValue(
      "http://prometheus-kube-prometheus-alertmanager.prometheus:9093",
    ),
    LOKI_URL: EnvValue.fromValue("http://loki.loki.svc.cluster.local:3100"),
    TEMPO_URL: EnvValue.fromValue("http://tempo.tempo.svc.cluster.local:3200"),
    OPS_INGEST_TOKEN: EnvValue.fromSecretValue({
      secret,
      key: "OPS_INGEST_TOKEN",
    }),
    LINEAR_API_KEY: EnvValue.fromSecretValue({ secret, key: "LINEAR_API_KEY" }),
    POSTHOG_PERSONAL_API_KEY: EnvValue.fromSecretValue({
      secret,
      key: "POSTHOG_PERSONAL_API_KEY",
    }),
  };
}
