import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  type ISecret,
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
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/service-monitor.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import type { Stage } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/scout.ts";
import { match } from "ts-pattern";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/zfs-nvme-volume.ts";
import { llmArchiveEnvVars } from "@shepherdjerred/homelab/cdk8s/src/misc/llm-archive-env.ts";
import {
  applyZfsVolumeSelinuxRelabeling,
  zfsVolumeSelinuxLevels,
} from "@shepherdjerred/homelab/cdk8s/src/misc/selinux.ts";
import { scoutAnalyticsConfiguration } from "@shepherdjerred/homelab/cdk8s/src/resources/scout/analytics.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { OTLP_GATEWAY_BASE_URL } from "@shepherdjerred/homelab/cdk8s/src/misc/otlp.ts";
import { createScoutGatewayDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/scout/gateway.ts";
import { createScoutGatewayRetirementGate } from "@shepherdjerred/homelab/cdk8s/src/resources/scout/gateway-retirement-gate.ts";
import { scoutRuntimeProbes } from "@shepherdjerred/homelab/cdk8s/src/resources/scout/probes.ts";
import {
  gatewayTopologyRunsRole,
  type ScoutGatewayTopology,
} from "@shepherdjerred/homelab/cdk8s/src/resources/scout/topology.ts";

function requiredBryanBucksControlSecret(secret: ISecret | undefined): ISecret {
  if (secret === undefined) {
    throw new Error("Beta Scout requires its Bryan Bucks control secret.");
  }
  return secret;
}

function requiredVoiceOpenAiSecret(secret: ISecret | undefined): ISecret {
  if (secret === undefined) {
    throw new Error("Beta Scout requires its voice OpenAI secret.");
  }
  return secret;
}

export function createScoutDeployment(
  chart: Chart,
  stage: Stage,
  gatewayTopology: ScoutGatewayTopology,
) {
  const analytics = scoutAnalyticsConfiguration(stage);
  const deployment = new Deployment(chart, "scout-backend", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    progressDeadline: Duration.seconds(2400),
    terminationGracePeriod: Duration.seconds(45),
    securityContext: {},
    // Stable pod label so the namespace NetworkPolicies select only the
    // backend — a bare podSelector would also catch the Patroni/Spilo
    // postgres pods and cut them off from the Kubernetes API.
    podMetadata: {
      labels: { app: "scout-backend" },
    },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root":
          "Scout requires flexible user permissions",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "Scout requires writable filesystem for the report lake and the retained legacy SQLite file",
      },
    },
  });
  const {
    path,
    imageVersion,
    applicationId,
    s3BucketName,
    selinuxLevel,
    cpuRequest,
    memoryRequest,
  } = match(stage)
    .with("beta", () => {
      return {
        imageVersion: versions["shepherdjerred/scout-for-lol/beta"],
        path: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/rtu44pohnp5ixdp2njuv5f6t2e",
        applicationId: "1311755320745394317",
        s3BucketName: "scout-beta",
        selinuxLevel: zfsVolumeSelinuxLevels.scoutBeta,
        cpuRequest: Cpu.millis(50),
        // 3Gi, up from 2Gi: beta is the only stage that loads the Hey Scout
        // voice runtime (three sherpa int8 graphs, silero VAD, and the
        // openWakeWord cascade) on top of the report lake. Sized from
        // streambot's 2Gi request for a comparable pipeline plus Scout's
        // existing baseline; re-tune from observed usage under a live session
        // rather than guessing again.
        memoryRequest: Size.gibibytes(3),
      };
    })
    .with("prod", () => {
      return {
        imageVersion: versions["shepherdjerred/scout-for-lol/prod"],
        path: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/pacrc4wfbtct4y3qazkvazop5a",
        applicationId: "1182800769188110366",
        s3BucketName: "scout-prod",
        selinuxLevel: zfsVolumeSelinuxLevels.scoutProd,
        cpuRequest: Cpu.millis(100),
        memoryRequest: Size.mebibytes(2560),
      };
    })
    .exhaustive();

  const onePasswordItem = new OnePasswordItem(chart, "scout-for-lol-1p", {
    spec: {
      itemPath: path,
    },
  });
  // The vault item keeps its original name; only the Kubernetes secret and the
  // environment variable follow the feature that still uses the credential.
  const bryanBucksControlSecret =
    stage === "beta"
      ? Secret.fromSecretName(
          chart,
          "scout-bryan-bucks-control-secret",
          new OnePasswordItem(chart, "scout-bryan-bucks-control-1p", {
            metadata: { name: "scout-bryan-bucks-control" },
            spec: { itemPath: vaultItemPath("scout-weekly-parlay-control") },
          }).name,
        )
      : undefined;
  // Hey Scout's OpenAI Realtime credential. A dedicated item rather than a
  // field on scout-for-lol-1p so it rotates on its own (OpenTofu mints it as
  // the `scout-voice-2026-09` service account), and beta-only because
  // production is hard-disabled for voice in code.
  const voiceOpenAiSecret =
    stage === "beta"
      ? Secret.fromSecretName(
          chart,
          "scout-openai-secret",
          new OnePasswordItem(chart, "scout-openai-1p", {
            metadata: { name: "scout-openai" },
            spec: { itemPath: vaultItemPath("scout-openai") },
          }).name,
        )
      : undefined;
  // PostgreSQL credentials secret generated by postgres-operator
  // ({username}.{cluster}.credentials...; see resources/postgres/scout-db.ts).
  // Scout is PostgreSQL-only: DATABASE_URL is composed via K8s $(VAR)
  // substitution, which only sees env vars defined EARLIER in the list — so
  // ...dbEnv must be spread FIRST in baseEnvVariables (same load-bearing
  // ordering as Bugsink).
  const pgSecretRef = Secret.fromSecretName(
    chart,
    "scout-pg-secret-ref",
    `scout.scout-${stage}-postgresql.credentials.postgresql.acid.zalan.do`,
  );
  const dbEnv: Record<string, EnvValue> = {
    DB_USER: EnvValue.fromSecretValue({
      secret: pgSecretRef,
      key: "username",
    }),
    DB_PASSWORD: EnvValue.fromSecretValue({
      secret: pgSecretRef,
      key: "password",
    }),
    DATABASE_URL: EnvValue.fromValue(
      `postgresql://$(DB_USER):$(DB_PASSWORD)@scout-${stage}-postgresql.scout-${stage}.svc.cluster.local:5432/scout`,
    ),
  };

  const localPathVolume = new ZfsNvmeVolume(chart, "scout-storage-claim", {
    // 48Gi: the retained legacy /data/db.sqlite is about 12Gi and a full
    // report-lake rebuild writes a new snapshot beside the retained builds
    // before garbage collection. 24Gi cannot provide that working headroom;
    // shrink only after the legacy file is deleted post-soak.
    storage: Size.gibibytes(48),
  });
  const dataVolumeMount = {
    path: "/data",
    volume: Volume.fromPersistentVolumeClaim(
      chart,
      "scout-volume",
      localPathVolume.claim,
    ),
  };
  // Voice is a gateway-role capability: the table gives voiceAssistant and
  // voiceStateAccess to `combined` and `gateway`, never to `application`. So on
  // a split stage the credential follows the shard into scout-gateway, and this
  // pod — which runs `application` — neither mounts nor needs it. On an unsplit
  // stage the combined pod keeps it exactly as #2870 wired it.
  const splitTopology = gatewayTopologyRunsRole(gatewayTopology);
  const voiceSecretMount =
    stage === "beta"
      ? {
          path: "/run/secrets/scout-openai",
          volume: Volume.fromSecret(
            chart,
            "scout-openai-volume",
            requiredVoiceOpenAiSecret(voiceOpenAiSecret),
            {
              // Deliberately optional, not an oversight of the fail-fast
              // secrets rule. The backend treats an absent credential as the
              // designed `unconfigured` status reported at `/scout join`, and
              // loads voice lazily rather than at boot. Requiring it would
              // leave the pod unschedulable until the Secret exists — and
              // since the split that is the pod holding the Discord shard, so
              // a rotation would take every slash command down for the sake of
              // a flag-gated feature. The full argument, with its sources in
              // the backend, is on the test that pins this in
              // scout-voice-boundary.test.ts.
              optional: true,
            },
          ),
        }
      : undefined;
  const volumeMounts =
    voiceSecretMount !== undefined && !splitTopology
      ? [dataVolumeMount, voiceSecretMount]
      : [dataVolumeMount];

  const baseEnvVariables = {
    ...dbEnv,
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
    OTLP_ENDPOINT: EnvValue.fromValue(OTLP_GATEWAY_BASE_URL),
    TEMPORAL_ADDRESS: EnvValue.fromValue(
      "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
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
    // Bootstrap for the flag client — these cannot come from a flag.
    FEATURE_FLAGS_MODE: EnvValue.fromValue("flipt"),
    FLIPT_ENVIRONMENT: EnvValue.fromValue(stage),
    FLIPT_NAMESPACE: EnvValue.fromValue("scout"),
    TEMPORAL_NAMESPACE: EnvValue.fromValue(stage),
    // Scout owns and reconciles report schedules in its stage namespace.
    TEMPORAL_SCHEDULE_RECONCILIATION: EnvValue.fromValue("auto"),
    FLIPT_URL: EnvValue.fromValue(
      "http://flipt-flipt-service.flipt.svc.cluster.local:8080",
    ),
    POSTHOG_PROJECT_TOKEN: EnvValue.fromValue(analytics.projectToken),
    POSTHOG_API_HOST: EnvValue.fromValue(analytics.apiHost),
    POSTHOG_SITE_KEY: EnvValue.fromValue(analytics.siteKey),
    POSTHOG_SITE_HOSTNAME: EnvValue.fromValue(analytics.siteHostname),
    // The retained legacy SQLite file: read exactly once by the boot-time
    // importer (scripts/import-legacy-sqlite.ts), never written again, and
    // kept as the rollback path for the Postgres migration.
    LEGACY_SQLITE_PATH: EnvValue.fromValue("/data/db.sqlite"),
    // Parquet "report lake" queried by the DuckDB report engine. Disposable
    // derived data on the same PVC as the legacy DB file; rebuilt from S3 by
    // the report-lake compaction crons.
    REPORT_LAKE_DIR: EnvValue.fromValue("/data/report-lake"),
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
    LLM_HOURLY_TOKEN_BUDGET: EnvValue.fromValue("2000000"),
    LLM_DAILY_TOKEN_BUDGET: EnvValue.fromValue("20000000"),
    OPENROUTER_API_KEY: EnvValue.fromSecretValue({
      secret: Secret.fromSecretName(
        chart,
        "openrouter-api-key-secret",
        onePasswordItem.name,
      ),
      key: "OPENROUTER_API_KEY",
    }),
  };

  // Beta keeps its operator-managed Explore preview allowlist. Production
  // authorizes signed-in users against the bot's live connected-guild set.
  const envVariables =
    stage === "beta"
      ? {
          ...baseEnvVariables,
          BRYAN_BUCKS_CONTROL_TOKEN: EnvValue.fromSecretValue({
            secret: requiredBryanBucksControlSecret(bryanBucksControlSecret),
            key: "token",
          }),
          // Beta's entire access gate: sign in, and belong to one of these
          // Discord servers. An unset or empty list denies everyone, so this
          // must be present for anyone to reach /app/explore in beta.
          EXPLORE_GUILD_ALLOWLIST: EnvValue.fromValue("1337623164146155593"),
        }
      : baseEnvVariables;

  // Hey Scout's credential and bootstrap surface. Activation itself is the
  // `voice_assistant_enabled` Flipt flag and lives nowhere here: the backend
  // loads its models lazily on first `/scout join`, so there is no env gate to
  // duplicate the flag's authority. Production omits these because it has no
  // voice credential and is hard-disabled for the flag in code.
  //
  // A Secret volume is updated in a running pod when 1Password populates the
  // key. The lazy loader reads it on every attempt, so the credential handoff
  // needs neither an unschedulable pod nor an imperative restart.
  //
  // Held separately from envVariables because these follow the shard: on a
  // split stage they belong to scout-gateway, which is the process that
  // actually runs `/scout join`.
  const voiceEnvVariables: Record<string, EnvValue> =
    stage === "beta"
      ? {
          OPENAI_API_KEY_FILE: EnvValue.fromValue(
            "/run/secrets/scout-openai/OPENAI_API_KEY",
          ),
          VOICE_ASSETS_DIR: EnvValue.fromValue("/opt/scout/voice"),
          VOICE_KWS_RUNTIME: EnvValue.fromValue("auto"),
        }
      : {};

  // A split stage runs this Deployment as the `application` role, with the
  // Discord shard — and therefore voice — moved to scout-gateway. Every other
  // stage stays on the combined role, which is what an unset SCOUT_RUNTIME_ROLE
  // resolves to, so an unsplit stage's manifest is unchanged by the split.
  const roleEnvVariables: Record<string, EnvValue> = splitTopology
    ? {
        ...envVariables,
        SCOUT_RUNTIME_ROLE: EnvValue.fromValue("application"),
      }
    : { ...envVariables, ...voiceEnvVariables };

  deployment.addContainer(
    withCommonProps({
      image: `ghcr.io/shepherdjerred/scout-for-lol:${imageVersion}`,
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
      // Keep stage-specific baselines; contain outliers instead of allowing
      // one process to consume the node's shared burst memory.
      resources: {
        cpu: {
          request: cpuRequest,
        },
        memory: {
          request: memoryRequest,
          limit: Size.gibibytes(8),
        },
      },
      ...scoutRuntimeProbes(),
      volumeMounts,
      envVariables: roleEnvVariables,
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

  // The gateway role shares this stage's claim and SELinux level by design;
  // see createScoutGatewayDeployment for why that is safe for this role and
  // not for activity-worker. The pin is already proven safe for a second pod
  // above, before any of this stage's resources were built.
  //
  // Rendered while retiring as well as while split — at zero replicas, which is
  // how the rollback retires the pod without an operator scaling it by hand.
  // Retiring also renders the gate that holds the backend's return to
  // `combined` until that pod has actually exited.
  // The claim is still declared on a retiring Deployment; with no pod it is
  // never mounted, so the read-only co-mount argument above is unaffected.
  if (gatewayTopology !== "absent") {
    createScoutGatewayDeployment(chart, stage, {
      topology: gatewayTopology,
      imageVersion,
      envVariables: { ...envVariables, ...voiceEnvVariables },
      claim: localPathVolume.claim,
      selinuxLevel,
      colocateWith: deployment,
      voiceSecretMount,
    });
  }
  if (gatewayTopology === "retiring") {
    createScoutGatewayRetirementGate(chart, stage);
  }
}
