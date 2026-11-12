import { temporalAddressEnv } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/address.ts";
import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  ConfigMap,
  Cpu,
  EnvValue,
  Secret,
  type ISecret,
  type ServiceAccount,
  Volume,
} from "cdk8s-plus-31";
import { llmArchiveEnvVars } from "@shepherdjerred/homelab/cdk8s/src/misc/llm-archive-env.ts";
import { createTemporalDomainWorker } from "./domain-worker.ts";
import { temporalRuntimeEnv } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/runtime-env.ts";
import { opsSnapshotEnv } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/ops-snapshot-env.ts";
import { rwfArchiveEnv } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/rwf-archive-env.ts";
import {
  telemetryEnv,
  seaweedfsS3,
  FLIPT_URL,
} from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";

function s3Env(secret: ISecret): Record<string, EnvValue> {
  return {
    S3_ENDPOINT: EnvValue.fromValue(seaweedfsS3.endpoint),
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
  fliptAuthSecret: ISecret;
  infraServiceAccount: ServiceAccount;
  homelabAuditEnvironment: Record<string, EnvValue>;
  talosConfigVolume: Volume;
  freshRssManifestVolume: Volume;
  freshRssCredentialVolume: Volume;
  billingSecret: ISecret;
};

export function createTemporalOperationsWorkers(
  chart: Chart,
  props: TemporalOperationsWorkerProps,
) {
  // kubectl does not discover in-cluster credentials automatically. This is
  // bootstrap configuration only; the projected token remains on the pod.
  const kubeconfig = new ConfigMap(chart, "infra-worker-kubeconfig", {
    data: {
      config: JSON.stringify({
        apiVersion: "v1",
        kind: "Config",
        clusters: [
          {
            name: "in-cluster",
            cluster: {
              server: "https://kubernetes.default.svc",
              "certificate-authority":
                "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
            },
          },
        ],
        users: [
          {
            name: "service-account",
            user: {
              tokenFile: "/var/run/secrets/kubernetes.io/serviceaccount/token",
            },
          },
        ],
        contexts: [
          {
            name: "in-cluster",
            context: { cluster: "in-cluster", user: "service-account" },
          },
        ],
        "current-context": "in-cluster",
      }),
    },
  });
  const infraDeployment = createTemporalDomainWorker(chart, {
    name: "temporal-infra-worker",
    component: "infra-worker",
    serviceAccount: props.infraServiceAccount,
    automountServiceAccountToken: true,
    cpuRequest: Cpu.millis(500),
    cpuLimit: Cpu.millis(1500),
    // Measured p95 working set (7d, 2026-10-31) is 2.0Gi, max 3.9Gi.
    memoryRequest: Size.mebibytes(2176),
    memoryLimit: Size.gibibytes(6),
    envVariables: {
      ...temporalRuntimeEnv(
        props.serverServiceName,
        props.secret,
        "infra",
        "temporal-infra-worker",
      ),
      NODE_EXTRA_CA_CERTS: EnvValue.fromValue(
        "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
      ),
      KUBECONFIG: EnvValue.fromValue("/etc/kubernetes/infra-worker/config"),
      DISABLE_AUTOUPDATER: EnvValue.fromValue("1"),
      OPENAI_API_KEY: EnvValue.fromSecretValue({
        secret: props.secret,
        key: "OPENAI_API_KEY",
      }),
      ...llmArchiveEnvVars(),
      ...s3Env(props.secret),
      ...githubEnv(props.secret),
      ...props.homelabAuditEnvironment,
      ...opsSnapshotEnv(props.secret),
      // The mining-reset queue's Red Warfare recording archive.
      ...rwfArchiveEnv(props.secret),
    },
    volumeMounts: [
      {
        path: "/etc/kubernetes/infra-worker",
        volume: Volume.fromConfigMap(
          chart,
          "infra-worker-kubeconfig-volume",
          kubeconfig,
        ),
        readOnly: true,
      },
      {
        path: "/etc/talos",
        volume: props.talosConfigVolume,
        readOnly: true,
      },
    ],
  });

  const billingDeployment = createTemporalDomainWorker(chart, {
    name: "temporal-billing-worker",
    component: "billing-worker",
    featureFlagsEnabled: false,
    automountServiceAccountToken: false,
    cpuRequest: Cpu.millis(100),
    cpuLimit: Cpu.millis(500),
    memoryRequest: Size.mebibytes(256),
    memoryLimit: Size.mebibytes(512),
    envVariables: {
      ...temporalAddressEnv(props.serverServiceName),
      TEMPORAL_NAMESPACE: EnvValue.fromValue("prod"),
      TEMPORAL_METRICS_ADDRESS: EnvValue.fromValue("0.0.0.0:9464"),
      TEMPORAL_WORKER_ROLE: EnvValue.fromValue("billing"),
      FEATURE_FLAGS_MODE: EnvValue.fromValue("disabled"),
      ENVIRONMENT: EnvValue.fromValue("production"),
      ...telemetryEnv({ serviceName: "temporal-billing-worker" }),
      OPENAI_ADMIN_KEY: EnvValue.fromSecretValue({
        secret: props.billingSecret,
        key: "OPENAI_ADMIN_KEY",
      }),
      // Read-only cost reports for every Anthropic workspace. Alerting on the
      // result lives in Prometheus, so this worker no longer posts to
      // Alertmanager itself.
      ANTHROPIC_ADMIN_API_KEY: EnvValue.fromSecretValue({
        secret: props.billingSecret,
        key: "ANTHROPIC_ADMIN_API_KEY",
      }),
    },
  });

  const repoDeployment = createTemporalDomainWorker(chart, {
    name: "temporal-repo-worker",
    component: "repo-worker",
    cpuRequest: Cpu.millis(250),
    cpuLimit: Cpu.millis(1500),
    memoryRequest: Size.mebibytes(288),
    memoryLimit: Size.gibibytes(4),
    envVariables: {
      ...temporalRuntimeEnv(
        props.serverServiceName,
        props.secret,
        "repo",
        "temporal-repo-worker",
      ),
      ...s3Env(props.secret),
      ...githubEnv(props.secret),
      ...llmArchiveEnvVars(),
      DOCKERHUB_READ_CONFIG_JSON: EnvValue.fromSecretValue({
        secret: Secret.fromSecretName(
          chart,
          "repo-worker-dockerhub-reader",
          "dockerhub-pull-temporal",
        ),
        key: ".dockerconfigjson",
      }),
      OPENAI_API_KEY: EnvValue.fromSecretValue({
        secret: props.secret,
        key: "OPENAI_API_KEY",
      }),
      S3_BUCKET_NAME: EnvValue.fromValue("better-skill-capped"),
      S3_KEY: EnvValue.fromValue("data/manifest.json"),
      WOODPECKER_TOKEN: EnvValue.fromSecretValue({
        secret: props.secret,
        key: "WOODPECKER_TOKEN",
      }),
      WOODPECKER_REPO_ID: EnvValue.fromValue("1"),
      // HTTP origin, not the agent gRPC endpoint WOODPECKER_SERVER names.
      WOODPECKER_URL: EnvValue.fromValue("https://woodpecker.sjer.red"),
      ALERTMANAGER_URL: EnvValue.fromValue(
        "http://prometheus-kube-prometheus-alertmanager.prometheus:9093",
      ),
      FLIPT_URL: EnvValue.fromValue(FLIPT_URL),
      FLIPT_OPERATOR_TOKEN: EnvValue.fromSecretValue({
        secret: props.fliptAuthSecret,
        key: "operator-token",
      }),
      FLIPT_ENVIRONMENT: EnvValue.fromValue("prod"),
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
      ...temporalRuntimeEnv(
        props.serverServiceName,
        props.secret,
        "scout",
        "temporal-scout-worker",
      ),
      ...s3Env(props.secret),
      ...githubEnv(props.secret),
      DISABLE_AUTOUPDATER: EnvValue.fromValue("1"),
      OPENAI_API_KEY: EnvValue.fromSecretValue({
        secret: props.secret,
        key: "OPENAI_API_KEY",
      }),
    },
  });

  return {
    infraDeployment,
    repoDeployment,
    scoutDeployment,
    billingDeployment,
  };
}
