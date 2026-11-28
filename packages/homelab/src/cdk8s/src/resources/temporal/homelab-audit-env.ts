import { EnvValue, type ISecret } from "cdk8s-plus-31";
import { ERRORS_ADMIN_ENDPOINT } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/endpoint.ts";
import { temporalFeatureFlagEnvironment } from "./feature-flags.ts";

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

export function homelabAuditEnv(
  secret: ISecret,
  argocdSecret: ISecret,
): Record<string, EnvValue> {
  return {
    ...temporalFeatureFlagEnvironment(),
    ERRORS_URL: EnvValue.fromValue(ERRORS_ADMIN_ENDPOINT.url),
    // HTTP origin of the Woodpecker server. Deliberately not
    // WOODPECKER_SERVER, which upstream uses for the agent's gRPC endpoint.
    WOODPECKER_URL: EnvValue.fromValue("https://woodpecker.sjer.red"),
    PROMETHEUS_URL: EnvValue.fromValue(
      "http://prometheus-kube-prometheus-prometheus.prometheus:9090",
    ),
    GCX_CONFIG: EnvValue.fromValue("/tmp/gcx-config.yaml"),
    GCX_NO_UPDATE_NOTIFIER: EnvValue.fromValue("1"),
    GCX_TELEMETRY: EnvValue.fromValue("disabled"),
    GRAFANA_URL: EnvValue.fromValue(
      "http://prometheus-grafana.prometheus.svc.cluster.local",
    ),
    ARGOCD_SERVER: EnvValue.fromValue("argocd.sjer.red"),
    WOODPECKER_REPO_ID: EnvValue.fromValue("1"),
    ARGOCD_AUTH_TOKEN: EnvValue.fromSecretValue({
      secret: argocdSecret,
      key: "ARGOCD_AUTH_TOKEN",
    }),
    ...requiredSecretEnv(secret, [
      "GRAFANA_API_KEY",
      "CLOUDFLARE_API_TOKEN",
      "WOODPECKER_TOKEN",
    ]),
    ALERT_DASHBOARD_URL: EnvValue.fromValue(
      "http://alert-dashboard-alert-dashboard-service.alert-dashboard:7341",
    ),
    TALOSCONFIG: EnvValue.fromValue("/etc/talos/config"),
  };
}
