import { temporalAddressEnv } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/address.ts";
import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Cpu, DeploymentStrategy, EnvValue, type ISecret } from "cdk8s-plus-31";
import { restrictedContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { FirstPartyWebService } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/web-service.ts";
import {
  MEDIA_APPLICATION_LABEL,
  MEDIA_PUBLIC_ORIGIN,
  mediaDatabaseEnvironment,
  mediaFeatureFlagEnvironment,
} from "./environment.ts";

export function createMediaApi(
  chart: Chart,
  props: {
    image: string;
    database: ISecret;
    bootstrap: ISecret;
    plexServiceName: string;
  },
) {
  if (
    props.image !== "docker.io/shepherdjerred/media:delivery-recipe" &&
    !/^docker\.io\/shepherdjerred\/media@sha256:[a-f0-9]{64}$/u.test(
      props.image,
    )
  )
    throw new Error("Media requires a pinned image digest");
  const securityContext = restrictedContainer(1000);
  const database = mediaDatabaseEnvironment(props.database);
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
          HOST: EnvValue.fromValue("0.0.0.0"),
          PORT: EnvValue.fromValue("7352"),
          ENVIRONMENT: EnvValue.fromValue("production"),
          PUBLIC_ORIGIN: EnvValue.fromValue(MEDIA_PUBLIC_ORIGIN),
          PLEX_SERVER_URL: EnvValue.fromValue(
            `http://${props.plexServiceName}:32400`,
          ),
          HOME: EnvValue.fromValue("/tmp"),
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
      hosts: [{ id: "media-api-ingress", host: "media" }],
    },
    // The API's policy renders with the workers' in `network-policy.ts`,
    // after the workers themselves.
    policies: [],
  }).deployment;
}
