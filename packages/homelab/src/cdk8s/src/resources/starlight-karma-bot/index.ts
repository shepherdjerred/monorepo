import {
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Probe,
  Secret,
  Volume,
} from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import { withCommonProps } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { match } from "ts-pattern";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";

export type Stage = "prod" | "beta";

export function createStarlightKarmaBotDeployment(chart: Chart, stage: Stage) {
  const deployment = new Deployment(chart, "starlight-karma-bot-backend", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      fsGroup: 1000,
      ensureNonRoot: false,
    },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root":
          "Starlight Karma Bot requires flexible user permissions",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "Bot requires writable filesystem for SQLite database",
      },
    },
  });

  const { path, image, applicationId } = match(stage)
    .with("beta", () => {
      return {
        image: `ghcr.io/shepherdjerred/starlight-karma-bot:${versions["shepherdjerred/starlight-karma-bot/beta"]}`,
        path: vaultItemPath("tdxe6cq7ozhv7cesfvnlkl5gh4"),
        applicationId: "1092616671388254248",
      };
    })
    .with("prod", () => {
      return {
        image: `ghcr.io/shepherdjerred/starlight-karma-bot:${versions["shepherdjerred/starlight-karma-bot/prod"]}`,
        path: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/cmp6si6n5syhr4smxew3qfcmfi",
        applicationId: "716834761418735638",
      };
    })
    .exhaustive();

  const onePasswordItem = new OnePasswordItem(chart, "starlight-karma-bot-1p", {
    spec: {
      itemPath: path,
    },
  });

  const localPathVolume = new ZfsNvmeVolume(
    chart,
    "starlight-karma-bot-storage-claim",
    {
      storage: Size.gibibytes(2),
    },
  );

  deployment.addContainer(
    withCommonProps({
      // Deliberately BestEffort (no requests/limits) — negligible or
      // non-critical usage; see the 2026-06-12 right-sizing plan.
      resources: {},
      image: image,
      securityContext: {
        readOnlyRootFilesystem: false,
        ensureNonRoot: false,
      },
      ports: [{ number: 8000, name: "health" }],
      // The bot has always served a health endpoint, but nothing ever called
      // it: the Dockerfile HEALTHCHECK is inert under Kubernetes, so a process
      // whose Discord gateway died stayed "healthy" indefinitely.
      //
      // `/live` reports 503 only after the gateway has been down for more than
      // five minutes, so ordinary discord.js reconnects never recycle the pod
      // but a wedged one does. The generous startup budget (24 x 5s = 120s)
      // covers `prisma migrate deploy` running before the Discord login.
      startup: Probe.fromHttpGet("/live", {
        port: 8000,
        periodSeconds: Duration.seconds(5),
        failureThreshold: 24,
      }),
      liveness: Probe.fromHttpGet("/live", {
        port: 8000,
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
      readiness: Probe.fromHttpGet("/ready", {
        port: 8000,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 3,
      }),
      volumeMounts: [
        {
          path: "/data",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "starlight-karma-bot-volume",
            localPathVolume.claim,
          ),
        },
      ],
      envVariables: {
        DISCORD_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "discord-token-secret",
            onePasswordItem.name,
          ),
          key: "DISCORD_TOKEN",
        }),
        APPLICATION_ID: EnvValue.fromValue(applicationId),
        DATA_DIR: EnvValue.fromValue("/data"),
        // Prisma-native database, backfilled on first boot from the legacy
        // TypeORM `glitter.sqlite`.
        DATABASE_PATH: EnvValue.fromValue("/data/karma.db"),
        // Drives the automatic one-shot import at startup. The import is
        // idempotent — once `karma.db` has rows it is skipped — so this stays
        // set permanently rather than needing a follow-up deploy to remove.
        // The legacy file is only ever read, and remains the rollback artifact.
        LEGACY_DATABASE_PATH: EnvValue.fromValue("/data/glitter.sqlite"),
        ENVIRONMENT: EnvValue.fromValue(stage),
        PORT: EnvValue.fromValue("8000"),
        SENTRY_DSN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "sentry-dsn-secret",
            onePasswordItem.name,
          ),
          key: "SENTRY_DSN",
        }),
      },
    }),
  );
}
