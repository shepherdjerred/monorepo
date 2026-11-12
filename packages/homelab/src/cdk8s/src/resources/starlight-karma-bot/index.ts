import { firstPartyImageRecipe } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { EnvValue, Secret } from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { match } from "ts-pattern";
import {
  fliptEnv,
  bugsinkEnv,
} from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
import { httpProbes } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/kubelet-probes.ts";
import { FirstPartyWorker } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/worker.ts";

export type Stage = "prod" | "beta";

export function createStarlightKarmaBotDeployment(chart: Chart, stage: Stage) {
  const { path, image, applicationId } = match(stage)
    .with("beta", () => {
      return {
        image: firstPartyImageRecipe("starlight-karma-bot"),
        path: vaultItemPath("tdxe6cq7ozhv7cesfvnlkl5gh4"),
        applicationId: "1092616671388254248",
      };
    })
    .with("prod", () => {
      return {
        image: firstPartyImageRecipe("starlight-karma-bot"),
        path: vaultItemPath("cmp6si6n5syhr4smxew3qfcmfi"),
        applicationId: "716834761418735638",
      };
    })
    .exhaustive();

  new FirstPartyWorker(chart, "starlight-karma-bot-worker", {
    name: "starlight-karma-bot-backend",
    deployment: {
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
    },
    // The Deployment has never set a revision history limit.
    revisionHistoryLimit: false,
    containers: () => {
      const onePasswordItem = new OnePasswordItem(
        chart,
        "starlight-karma-bot-1p",
        {
          spec: {
            itemPath: path,
          },
        },
      );

      return {
        main: {
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
          ...httpProbes(8000, {
            live: "/live",
            ready: "/ready",
            startup: { failureThreshold: 24 },
          }),
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
            // The bot owner may configure recaps without holding Manage Server in
            // the guild. This is an identity, not a credential.
            //
            // KARMA_ADMIN_USER_ID and KARMA_EMOJI are now the ENV LAYER beneath
            // their flags: a Flipt value for `karma-admin-user-id` or `karma-emoji`
            // outranks these, and with no flag defined they still apply. Keeping
            // them is what makes the migration a no-op until someone creates the
            // flag.
            KARMA_ADMIN_USER_ID: EnvValue.fromValue("160509172704739328"),
            // Bootstrap for the flag client itself — it cannot come from a flag.
            ...fliptEnv({
              namespace: "starlight-karma-bot",
              environment: stage,
              order: ["FLIPT_ENVIRONMENT", "FLIPT_NAMESPACE", "FLIPT_URL"],
            }),
            DATA_DIR: EnvValue.fromValue("/data"),
            // Prisma-native database, backfilled once from the legacy TypeORM
            // `glitter.sqlite`, which stays on the volume untouched.
            DATABASE_PATH: EnvValue.fromValue("/data/karma.db"),
            ENVIRONMENT: EnvValue.fromValue(stage),
            PORT: EnvValue.fromValue("8000"),
            ...bugsinkEnv(
              Secret.fromSecretName(
                chart,
                "bugsink-dsn-secret",
                onePasswordItem.name,
              ),
            ),
          },
        },
      };
    },
    data: {
      id: "starlight-karma-bot-storage-claim",
      storage: Size.gibibytes(2),
      volumeId: "starlight-karma-bot-volume",
      path: "/data",
    },
    metrics: {
      serviceId: "starlight-karma-bot-metrics-service",
      serviceName: "starlight-karma-bot-metrics",
      app: "starlight-karma-bot-metrics",
      port: 8000,
      targetPort: 8000,
      monitorName: "starlight-karma-bot-metrics",
    },
    // The namespaces have no NetworkPolicies yet; fleet-policy lists them.
    policies: [],
  });
}
