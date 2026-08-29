import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  Cpu,
  EnvValue,
  type ISecret,
  type ServiceAccount,
  type Volume,
} from "cdk8s-plus-31";
import { llmArchiveEnvVars } from "@shepherdjerred/homelab/cdk8s/src/misc/llm-archive-env.ts";
import { createTemporalDomainWorker } from "./domain-worker.ts";

function runtimeEnv(
  serverServiceName: string,
  secret: ISecret,
  role: "infra" | "repo" | "scout",
  serviceName: string,
): Record<string, EnvValue> {
  return {
    TEMPORAL_ADDRESS: EnvValue.fromValue(`${serverServiceName}:7233`),
    TEMPORAL_NAMESPACE: EnvValue.fromValue("prod"),
    TEMPORAL_LEGACY_NAMESPACE: EnvValue.fromValue("default"),
    TEMPORAL_METRICS_ADDRESS: EnvValue.fromValue("0.0.0.0:9464"),
    TEMPORAL_WORKER_ROLE: EnvValue.fromValue(role),
    ENVIRONMENT: EnvValue.fromValue("production"),
    TELEMETRY_ENABLED: EnvValue.fromValue("true"),
    OTLP_ENDPOINT: EnvValue.fromValue(
      "http://tempo.tempo.svc.cluster.local:4318",
    ),
    TELEMETRY_SERVICE_NAME: EnvValue.fromValue(serviceName),
    SENTRY_DSN: EnvValue.fromSecretValue({ secret, key: "SENTRY_DSN" }),
  };
}

function s3Env(secret: ISecret): Record<string, EnvValue> {
  return {
    S3_ENDPOINT: EnvValue.fromSecretValue({ secret, key: "S3_ENDPOINT" }),
    S3_REGION: EnvValue.fromValue("us-east-1"),
    AWS_REGION: EnvValue.fromValue("us-east-1"),
    AWS_DEFAULT_REGION: EnvValue.fromValue("us-east-1"),
    S3_FORCE_PATH_STYLE: EnvValue.fromValue("true"),
    AWS_ACCESS_KEY_ID: EnvValue.fromSecretValue({
      secret,
      key: "AWS_ACCESS_KEY_ID",
    }),
    AWS_SECRET_ACCESS_KEY: EnvValue.fromSecretValue({
      secret,
      key: "AWS_SECRET_ACCESS_KEY",
    }),
  };
}

function githubEnv(secret: ISecret): Record<string, EnvValue> {
  return {
    GITHUB_APP_ID: EnvValue.fromSecretValue({
      secret,
      key: "GITHUB_APP_ID",
    }),
    GITHUB_APP_INSTALLATION_ID: EnvValue.fromSecretValue({
      secret,
      key: "GITHUB_APP_INSTALLATION_ID",
    }),
    GITHUB_APP_PRIVATE_KEY: EnvValue.fromSecretValue({
      secret,
      key: "GITHUB_APP_PRIVATE_KEY",
    }),
    GIT_AUTHOR_NAME: EnvValue.fromValue("temporal-worker[bot]"),
    GIT_AUTHOR_EMAIL: EnvValue.fromValue("temporal-worker@homelab.local"),
    GIT_COMMITTER_NAME: EnvValue.fromValue("temporal-worker[bot]"),
    GIT_COMMITTER_EMAIL: EnvValue.fromValue("temporal-worker@homelab.local"),
  };
}

export type TemporalOperationsWorkerProps = {
  serverServiceName: string;
  secret: ISecret;
  scoutWeeklyParlaySecret: ISecret;
  infraServiceAccount: ServiceAccount;
  homelabAuditEnvironment: Record<string, EnvValue>;
  talosConfigVolume: Volume;
  freshRssManifestVolume: Volume;
  freshRssCredentialVolume: Volume;
};

export function createTemporalOperationsWorkers(
  chart: Chart,
  props: TemporalOperationsWorkerProps,
) {
  const infraDeployment = createTemporalDomainWorker(chart, {
    name: "temporal-infra-worker",
    component: "infra-worker",
    serviceAccount: props.infraServiceAccount,
    automountServiceAccountToken: true,
    cpuRequest: Cpu.millis(500),
    cpuLimit: Cpu.millis(1500),
    memoryRequest: Size.gibibytes(2),
    memoryLimit: Size.gibibytes(6),
    envVariables: {
      ...runtimeEnv(
        props.serverServiceName,
        props.secret,
        "infra",
        "temporal-infra-worker",
      ),
      NODE_EXTRA_CA_CERTS: EnvValue.fromValue(
        "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
      ),
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: EnvValue.fromValue("1"),
      DISABLE_AUTOUPDATER: EnvValue.fromValue("1"),
      CLAUDE_CODE_OAUTH_TOKEN: EnvValue.fromSecretValue({
        secret: props.secret,
        key: "CLAUDE_CODE_OAUTH_TOKEN",
      }),
      OPENROUTER_API_KEY: EnvValue.fromSecretValue({
        secret: props.secret,
        key: "OPENROUTER_API_KEY",
      }),
      ...llmArchiveEnvVars(),
      ...s3Env(props.secret),
      ...githubEnv(props.secret),
      ...props.homelabAuditEnvironment,
    },
    volumeMounts: [
      {
        path: "/etc/talos",
        volume: props.talosConfigVolume,
        readOnly: true,
      },
    ],
  });

  const repoDeployment = createTemporalDomainWorker(chart, {
    name: "temporal-repo-worker",
    component: "repo-worker",
    cpuRequest: Cpu.millis(250),
    cpuLimit: Cpu.millis(1500),
    memoryRequest: Size.mebibytes(512),
    memoryLimit: Size.gibibytes(4),
    envVariables: {
      ...runtimeEnv(
        props.serverServiceName,
        props.secret,
        "repo",
        "temporal-repo-worker",
      ),
      ...s3Env(props.secret),
      ...githubEnv(props.secret),
      ...llmArchiveEnvVars(),
      OPENROUTER_API_KEY: EnvValue.fromSecretValue({
        secret: props.secret,
        key: "OPENROUTER_API_KEY",
      }),
      S3_BUCKET_NAME: EnvValue.fromSecretValue({
        secret: props.secret,
        key: "S3_BUCKET_NAME",
      }),
      S3_KEY: EnvValue.fromValue("data/manifest.json"),
      BUILDKITE_API_TOKEN: EnvValue.fromSecretValue({
        secret: props.secret,
        key: "BUILDKITE_API_TOKEN",
      }),
      BUILDKITE_ORGANIZATION_SLUG: EnvValue.fromValue("sjerred"),
      BUILDKITE_PIPELINE_SLUG: EnvValue.fromValue("monorepo"),
      ALERTMANAGER_URL: EnvValue.fromValue(
        "http://prometheus-kube-prometheus-alertmanager.prometheus:9093",
      ),
      FLIPT_URL: EnvValue.fromValue(
        "http://flipt-flipt-service.flipt.svc.cluster.local:8080",
      ),
      FLIPT_ENVIRONMENT: EnvValue.fromValue("default"),
      FRESHRSS_API_URL: EnvValue.fromValue(
        "http://freshrss-service.freshrss.svc.cluster.local/api/greader.php",
      ),
      FRESHRSS_USER: EnvValue.fromValue("sjerred"),
      FRESHRSS_CATEGORY: EnvValue.fromValue("Repo Stack"),
      FRESHRSS_MANIFEST_PATH: EnvValue.fromValue("/etc/freshrss/desired.json"),
      FRESHRSS_API_PASSWORD_FILE: EnvValue.fromValue(
        "/run/secrets/freshrss/password",
      ),
    },
    volumeMounts: [
      {
        path: "/etc/freshrss",
        volume: props.freshRssManifestVolume,
        readOnly: true,
      },
      {
        path: "/run/secrets/freshrss",
        volume: props.freshRssCredentialVolume,
        readOnly: true,
      },
    ],
  });

  const scoutDeployment = createTemporalDomainWorker(chart, {
    name: "temporal-scout-worker",
    component: "scout-worker",
    cpuRequest: Cpu.millis(250),
    cpuLimit: Cpu.millis(1500),
    memoryRequest: Size.mebibytes(512),
    memoryLimit: Size.gibibytes(4),
    envVariables: {
      ...runtimeEnv(
        props.serverServiceName,
        props.secret,
        "scout",
        "temporal-scout-worker",
      ),
      ...s3Env(props.secret),
      ...githubEnv(props.secret),
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: EnvValue.fromValue("1"),
      DISABLE_AUTOUPDATER: EnvValue.fromValue("1"),
      CLAUDE_CODE_OAUTH_TOKEN: EnvValue.fromSecretValue({
        secret: props.secret,
        key: "CLAUDE_CODE_OAUTH_TOKEN",
      }),
      SCOUT_WEEKLY_PARLAY_CONTROL_URL: EnvValue.fromValue(
        "http://scout-service-beta.scout-beta.svc.cluster.local:3000/api/internal/weekly-parlays/actions",
      ),
      SCOUT_WEEKLY_PARLAY_CONTROL_TOKEN: EnvValue.fromSecretValue({
        secret: props.scoutWeeklyParlaySecret,
        key: "token",
      }),
    },
  });

  return { infraDeployment, repoDeployment, scoutDeployment };
}
