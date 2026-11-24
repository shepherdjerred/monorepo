import { temporalAddressEnv } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/address.ts";
import { tailnetService } from "homelab/src/platform-model.ts";
import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Cpu, DeploymentStrategy, EnvValue, type ISecret } from "cdk8s-plus-31";
import { restrictedContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { FirstPartyWebService } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/web-service.ts";
import type { SingleAppDatabase } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/postgres-database.ts";
import { requireFirstPartyImage } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import {
  MEDIA_APPLICATION_LABEL,
  MEDIA_PUBLIC_ORIGIN,
  mediaFeatureFlagEnvironment,
} from "./environment.ts";

/**
 * The artwork cache's volume: the claim name is the backup policy's
 * `media/media-artwork-cache` exclusion, and the API reads the mount path from
 * `MEDIA_ARTWORK_CACHE_DIR`. The cache is rebuildable from TMDB.
 */
const ARTWORK_CACHE_CLAIM = "media-artwork-cache";
const ARTWORK_CACHE_PATH = "/var/cache/media-artwork";

export function createMediaApi(
  chart: Chart,
  props: {
    image: string;
    database: SingleAppDatabase;
    bootstrap: ISecret;
    discord: ISecret;
    plexServiceName: string;
  },
) {
  requireFirstPartyImage("media", props.image);
  const securityContext = restrictedContainer(1000);
  const database = props.database.env;
  return new FirstPartyWebService(chart, "media-api-web-service", {
    name: "media-api",
    port: 7352,
    probes: {
      live: "/health",
      ready: "/readyz",
      startup: { failureThreshold: 24 },
    },
    deployment: {
      strategy: DeploymentStrategy.recreate(),
      automountServiceAccountToken: false,
      podMetadata: {
        labels: { app: "media-api", [MEDIA_APPLICATION_LABEL]: "true" },
      },
      securityContext: { fsGroup: 1000 },
    },
    // A ReadWriteOnce claim cannot attach to a second pod, so this deployment
    // stays `Recreate` with one replica: the old pod stops before the new one
    // mounts the claim. 2 GiB holds the 1 GiB cache cap
    // (`media-artwork-cache-max-bytes`) plus in-flight temporary files.
    data: {
      id: ARTWORK_CACHE_CLAIM,
      storage: Size.gibibytes(2),
      path: ARTWORK_CACHE_PATH,
    },
    containers: () => ({
      init: [
        {
          name: "prisma-migrate",
          image: props.image,
          command: ["bunx", "--no-install", "prisma", "migrate", "deploy"],
          securityContext,
          envVariables: { ...database, HOME: EnvValue.fromValue("/tmp") },
          resources: {
            cpu: { request: Cpu.millis(25), limit: Cpu.millis(250) },
            memory: { request: Size.mebibytes(64), limit: Size.mebibytes(256) },
          },
        },
      ],
      server: {
        image: props.image,
        command: ["bun", "src/server/index.ts"],
        securityContext,
        envVariables: {
          ...database,
          ...mediaFeatureFlagEnvironment(),
          ...Object.fromEntries(
            [
              "MEDIA_CREDENTIAL_KEY",
              "PLEX_SERVER_MACHINE_ID",
              "PLEX_OWNER_ACCOUNT_ID",
              "TMDB_API_KEY",
            ].map((key) => [
              key,
              EnvValue.fromSecretValue({ secret: props.bootstrap, key }),
            ]),
          ),
          DISCORD_CLIENT_ID: EnvValue.fromSecretValue({
            secret: props.discord,
            key: "DISCORD_CLIENT_ID",
          }),
          DISCORD_CLIENT_SECRET: EnvValue.fromSecretValue({
            secret: props.discord,
            key: "DISCORD_CLIENT_SECRET",
          }),
          HOST: EnvValue.fromValue("0.0.0.0"),
          PORT: EnvValue.fromValue("7352"),
          ENVIRONMENT: EnvValue.fromValue("production"),
          PUBLIC_ORIGIN: EnvValue.fromValue(MEDIA_PUBLIC_ORIGIN),
          PLEX_SERVER_URL: EnvValue.fromValue(
            `http://${props.plexServiceName}:32400`,
          ),
          HOME: EnvValue.fromValue("/tmp"),
          MEDIA_ARTWORK_CACHE_DIR: EnvValue.fromValue(ARTWORK_CACHE_PATH),
          ...temporalAddressEnv(),
          TEMPORAL_NAMESPACE: EnvValue.fromValue("prod"),
        },
        resources: {
          cpu: { request: Cpu.millis(100), limit: Cpu.millis(1000) },
          memory: { request: Size.mebibytes(256), limit: Size.mebibytes(768) },
        },
      },
    }),
    serviceName: "media-api",
    tailscale: {
      probePath: "/readyz",
      hosts: [{ id: "media-api-ingress", host: tailnetService("media") }],
    },
    // The API's policy renders with the workers' in `network-policy.ts`,
    // after the workers themselves.
    policies: [],
  }).deployment;
}
