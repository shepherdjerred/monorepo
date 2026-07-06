import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Probe,
  Protocol,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  withCommonProps,
  setRevisionHistoryLimit,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/service-monitor.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import type { Stage } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/scout.ts";
import { match } from "ts-pattern";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import { llmArchiveEnvVars } from "@shepherdjerred/homelab/cdk8s/src/misc/llm-archive-env.ts";
import {
  applyZfsVolumeSelinuxRelabeling,
  zfsVolumeSelinuxLevels,
} from "@shepherdjerred/homelab/cdk8s/src/misc/selinux.ts";

export function createScoutDeployment(chart: Chart, stage: Stage) {
  const deployment = new Deployment(chart, "scout-backend", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {},
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root":
          "Scout requires flexible user permissions",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "Scout requires writable filesystem for SQLite database",
      },
    },
  });

  const { path, image, applicationId, s3BucketName, selinuxLevel } = match(
    stage,
  )
    .with("beta", () => {
      return {
        image: `ghcr.io/shepherdjerred/scout-for-lol:${versions["shepherdjerred/scout-for-lol/beta"]}`,
        path: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/rtu44pohnp5ixdp2njuv5f6t2e",
        applicationId: "1311755320745394317",
        s3BucketName: "scout-beta",
        selinuxLevel: zfsVolumeSelinuxLevels.scoutBeta,
      };
    })
    .with("prod", () => {
      return {
        image: `ghcr.io/shepherdjerred/scout-for-lol:${versions["shepherdjerred/scout-for-lol/prod"]}`,
        path: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/pacrc4wfbtct4y3qazkvazop5a",
        applicationId: "1182800769188110366",
        s3BucketName: "scout-prod",
        selinuxLevel: zfsVolumeSelinuxLevels.scoutProd,
      };
    })
    .exhaustive();

  const onePasswordItem = new OnePasswordItem(chart, "scout-for-lol-1p", {
    spec: {
      itemPath: path,
    },
  });

  const localPathVolume = new ZfsNvmeVolume(chart, "scout-storage-claim", {
    // 24Gi: the SQLite match DB (/data/db.sqlite) grows over time and filled the
    // original 8Gi to 0B, wedging writes (2026-05). See follow-up for retention.
    storage: Size.gibibytes(24),
  });

  const baseEnvVariables = {
    APPLICATION_ID: EnvValue.fromValue(applicationId),
    AWS_ACCESS_KEY_ID: EnvValue.fromSecretValue({
      secret: Secret.fromSecretName(
        chart,
        "aws-access-key-id",
        onePasswordItem.name,
      ),
      key: "AWS_ACCESS_KEY_ID",
    }),
    AWS_SECRET_ACCESS_KEY: EnvValue.fromSecretValue({
      secret: Secret.fromSecretName(
        chart,
        "aws-access-key-secret",
        onePasswordItem.name,
      ),
      key: "AWS_SECRET_ACCESS_KEY",
    }),
    AWS_ENDPOINT_URL: EnvValue.fromValue(
      "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
    ),
    // S3_ENDPOINT mirrors AWS_ENDPOINT_URL for llm-observability + any other
    // tool that reads the SDK-style env var rather than the AWS-CLI one.
    S3_ENDPOINT: EnvValue.fromValue(
      "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
    ),
    S3_FORCE_PATH_STYLE: EnvValue.fromValue("true"),
    AWS_REGION: EnvValue.fromValue("us-east-1"),
    // OpenTelemetry → Tempo. The scout-backend tracing.ts bootstrap gates on
    // TELEMETRY_ENABLED.
    TELEMETRY_ENABLED: EnvValue.fromValue("true"),
    TELEMETRY_SERVICE_NAME: EnvValue.fromValue("scout-backend"),
    OTLP_ENDPOINT: EnvValue.fromValue(
      "http://tempo.tempo.svc.cluster.local:4318",
    ),
    ...llmArchiveEnvVars(),
    DISCORD_TOKEN: EnvValue.fromSecretValue({
      secret: Secret.fromSecretName(
        chart,
        "discord-token-secret",
        onePasswordItem.name,
      ),
      key: "DISCORD_TOKEN",
    }),
    RIOT_API_KEY: EnvValue.fromSecretValue({
      secret: Secret.fromSecretName(
        chart,
        "riot-api-key-secret",
        onePasswordItem.name,
      ),
      key: "RIOT_API_KEY",
    }),
    S3_BUCKET_NAME: EnvValue.fromValue(s3BucketName),
    SENTRY_DSN: EnvValue.fromSecretValue({
      secret: Secret.fromSecretName(
        chart,
        "sentry-dsn-secret",
        onePasswordItem.name,
      ),
      key: "SENTRY_DSN",
    }),
    ENVIRONMENT: EnvValue.fromValue(stage),
    DATABASE_URL: EnvValue.fromValue("file:/data/db.sqlite"),
    JWT_SIGNING_SECRET: EnvValue.fromSecretValue({
      secret: Secret.fromSecretName(
        chart,
        "jwt-signing-secret",
        onePasswordItem.name,
      ),
      key: "JWT_SIGNING_SECRET",
    }),
    DISCORD_CLIENT_SECRET: EnvValue.fromSecretValue({
      secret: Secret.fromSecretName(
        chart,
        "discord-client-secret",
        onePasswordItem.name,
      ),
      key: "DISCORD_CLIENT_SECRET",
    }),
    WEB_APP_ORIGIN: EnvValue.fromValue(
      stage === "prod"
        ? "https://scout-for-lol.com"
        : "https://beta.scout-for-lol.com",
    ),
    OPENAI_HOURLY_TOKEN_BUDGET: EnvValue.fromValue("2000000"),
    OPENAI_DAILY_TOKEN_BUDGET: EnvValue.fromValue("20000000"),
  };

  // Add AI secrets only for beta stage
  const envVariables =
    stage === "beta"
      ? {
          ...baseEnvVariables,
          OPENAI_API_KEY: EnvValue.fromSecretValue({
            secret: Secret.fromSecretName(
              chart,
              "openai-api-key-secret",
              onePasswordItem.name,
            ),
            key: "OPENAI_API_KEY",
          }),
          GEMINI_API_KEY: EnvValue.fromSecretValue({
            secret: Secret.fromSecretName(
              chart,
              "gemini-api-key-secret",
              onePasswordItem.name,
            ),
            key: "GEMINI_API_KEY",
          }),
        }
      : baseEnvVariables;

  deployment.addContainer(
    withCommonProps({
      image: image,
      ports: [
        {
          name: "port-3000",
          number: 3000,
          protocol: Protocol.TCP,
        },
      ],
      securityContext: {
        ensureNonRoot: false,
        readOnlyRootFilesystem: false,
      },
      // Baseline request (no limits) so the backend isn't BestEffort.
      // 30d peaks: prod ~145m / ~1.2Gi, beta ~60m / ~2.1Gi; steady ~30m / ~500Mi.
      resources: {
        cpu: {
          request: Cpu.millis(50),
        },
        memory: {
          request: Size.mebibytes(512),
        },
      },
      startup: Probe.fromHttpGet("/ping", {
        port: 3000,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 12,
      }),
      liveness: Probe.fromHttpGet("/livez", {
        port: 3000,
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
      readiness: Probe.fromHttpGet("/healthz", {
        port: 3000,
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
      volumeMounts: [
        {
          path: "/data",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "scout-volume",
            localPathVolume.claim,
          ),
        },
      ],
      envVariables,
    }),
  );

  applyZfsVolumeSelinuxRelabeling(deployment, selinuxLevel);

  setRevisionHistoryLimit(deployment);

  // Create Service to expose metrics port
  new Service(chart, `scout-service-${stage}`, {
    metadata: {
      name: `scout-service-${stage}`,
      labels: {
        app: "scout",
        stage: stage,
      },
    },
    selector: deployment,
    ports: [{ name: "metrics", port: 3000 }],
  });

  // Create ServiceMonitor for Prometheus to scrape Scout metrics
  createServiceMonitor(chart, {
    name: `scout-${stage}`,
    matchLabels: { app: "scout", stage },
  });
}
