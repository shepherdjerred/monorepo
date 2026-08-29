import { EnvValue, type ISecret } from "cdk8s-plus-31";
import { llmArchiveEnvVars } from "@shepherdjerred/homelab/cdk8s/src/misc/llm-archive-env.ts";
import { glitterCorpusEnv } from "./glitter-corpus-env.ts";
import { sleepWebhookEnv } from "./http-services.ts";

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

export function legacyWorkerEnvironment(props: {
  serverServiceName: string;
  secret: ISecret;
  starlightBotSecret: ISecret;
  scoutWeeklyParlaySecret: ISecret;
}): Record<string, EnvValue> {
  const secretValue = (key: string): EnvValue =>
    EnvValue.fromSecretValue({ secret: props.secret, key });
  return {
    TEMPORAL_ADDRESS: EnvValue.fromValue(`${props.serverServiceName}:7233`),
    TEMPORAL_METRICS_ADDRESS: EnvValue.fromValue("0.0.0.0:9464"),
    TEMPORAL_WORKER_ROLE: EnvValue.fromValue("legacy"),
    FRESHRSS_API_URL: EnvValue.fromValue(
      "http://freshrss-service.freshrss.svc.cluster.local/api/greader.php",
    ),
    FRESHRSS_USER: EnvValue.fromValue("sjerred"),
    FRESHRSS_CATEGORY: EnvValue.fromValue("Repo Stack"),
    FRESHRSS_MANIFEST_PATH: EnvValue.fromValue("/etc/freshrss/desired.json"),
    FRESHRSS_API_PASSWORD_FILE: EnvValue.fromValue(
      "/run/secrets/freshrss/password",
    ),
    ENVIRONMENT: EnvValue.fromValue("production"),
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: EnvValue.fromValue("1"),
    DISABLE_AUTOUPDATER: EnvValue.fromValue("1"),
    TELEMETRY_ENABLED: EnvValue.fromValue("true"),
    OTLP_ENDPOINT: EnvValue.fromValue(
      "http://tempo.tempo.svc.cluster.local:4318",
    ),
    TELEMETRY_SERVICE_NAME: EnvValue.fromValue("temporal-worker"),
    GIT_AUTHOR_NAME: EnvValue.fromValue("temporal-worker[bot]"),
    GIT_AUTHOR_EMAIL: EnvValue.fromValue("temporal-worker@homelab.local"),
    GIT_COMMITTER_NAME: EnvValue.fromValue("temporal-worker[bot]"),
    GIT_COMMITTER_EMAIL: EnvValue.fromValue("temporal-worker@homelab.local"),
    NODE_EXTRA_CA_CERTS: EnvValue.fromValue(
      "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
    ),
    HA_URL: secretValue("HA_URL"),
    HA_TOKEN: secretValue("HA_TOKEN"),
    S3_BUCKET_NAME: secretValue("S3_BUCKET_NAME"),
    S3_ENDPOINT: secretValue("S3_ENDPOINT"),
    S3_KEY: EnvValue.fromValue("data/manifest.json"),
    S3_REGION: EnvValue.fromValue("us-east-1"),
    AWS_REGION: EnvValue.fromValue("us-east-1"),
    AWS_DEFAULT_REGION: EnvValue.fromValue("us-east-1"),
    S3_FORCE_PATH_STYLE: EnvValue.fromValue("true"),
    ...llmArchiveEnvVars(),
    AWS_ACCESS_KEY_ID: secretValue("AWS_ACCESS_KEY_ID"),
    AWS_SECRET_ACCESS_KEY: secretValue("AWS_SECRET_ACCESS_KEY"),
    ...glitterCorpusEnv(props.secret, props.starlightBotSecret),
    GITHUB_APP_ID: secretValue("GITHUB_APP_ID"),
    GITHUB_APP_INSTALLATION_ID: secretValue("GITHUB_APP_INSTALLATION_ID"),
    GITHUB_APP_PRIVATE_KEY: secretValue("GITHUB_APP_PRIVATE_KEY"),
    GITHUB_WEBHOOK_SECRET: secretValue("GITHUB_WEBHOOK_SECRET"),
    GITHUB_WEBHOOK_PORT: EnvValue.fromValue("9466"),
    AGENT_TASK_API_PORT: EnvValue.fromValue("9467"),
    AGENT_TASK_API_TOKEN: secretValue("AGENT_TASK_API_TOKEN"),
    SCOUT_WEEKLY_PARLAY_CONTROL_URL: EnvValue.fromValue(
      "http://scout-service-beta.scout-beta.svc.cluster.local:3000/api/internal/weekly-parlays/actions",
    ),
    SCOUT_WEEKLY_PARLAY_CONTROL_TOKEN: EnvValue.fromSecretValue({
      secret: props.scoutWeeklyParlaySecret,
      key: "token",
    }),
    ...sleepWebhookEnv(props.secret),
    XCODE_CLOUD_WEBHOOK_PORT: EnvValue.fromValue("9468"),
    XCODE_CLOUD_WEBHOOK_TOKEN: secretValue("XCODE_CLOUD_WEBHOOK_TOKEN"),
    ALERTMANAGER_URL: EnvValue.fromValue(
      "http://prometheus-kube-prometheus-alertmanager.prometheus:9093",
    ),
    SENTRY_DSN: secretValue("SENTRY_DSN"),
    OPENROUTER_API_KEY: secretValue("OPENROUTER_API_KEY"),
    POSTAL_HOST: secretValue("POSTAL_HOST"),
    POSTAL_HOST_HEADER: secretValue("POSTAL_HOST_HEADER"),
    POSTAL_API_KEY: secretValue("POSTAL_API_KEY"),
    RECIPIENT_EMAIL: secretValue("RECIPIENT_EMAIL"),
    SENDER_EMAIL: secretValue("SENDER_EMAIL"),
    ...homelabAuditEnv(props.secret),
  };
}
