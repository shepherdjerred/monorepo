import { EnvValue, type ISecret } from "cdk8s-plus-31";

function requiredSecretEnv(
  secret: ISecret,
  keys: readonly string[],
): Record<string, EnvValue> {
  const env: Record<string, EnvValue> = {};
  for (const key of keys) {
    env[key] = EnvValue.fromSecretValue({ secret, key });
  }
  return env;
}

export function homelabAuditEnv(secret: ISecret): Record<string, EnvValue> {
  return {
    BUGSINK_URL: EnvValue.fromValue("https://bugsink.sjer.red"),
    BUILDKITE_ORGANIZATION_SLUG: EnvValue.fromValue("sjerred"),
    BUILDKITE_PIPELINE_SLUG: EnvValue.fromValue("monorepo"),
    PROMETHEUS_URL: EnvValue.fromValue(
      "http://prometheus-kube-prometheus-prometheus.prometheus:9090",
    ),
    GCX_CONFIG: EnvValue.fromValue("/tmp/gcx-config.yaml"),
    GCX_NO_UPDATE_NOTIFIER: EnvValue.fromValue("1"),
    GCX_TELEMETRY: EnvValue.fromValue("disabled"),
    ...requiredSecretEnv(secret, [
      "BUGSINK_TOKEN",
      "GRAFANA_URL",
      "GRAFANA_API_KEY",
      "ARGOCD_SERVER",
      "ARGOCD_AUTH_TOKEN",
      "CLOUDFLARE_API_TOKEN",
      "BUILDKITE_API_TOKEN",
    ]),
    ALERT_DASHBOARD_URL: EnvValue.fromValue(
      "http://alert-dashboard-alert-dashboard-service.alert-dashboard:7341",
    ),
    TALOSCONFIG: EnvValue.fromValue("/etc/talos/config"),
  };
}
