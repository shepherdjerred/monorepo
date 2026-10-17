import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  Capability,
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  type ISecret,
  Probe,
  SeccompProfileType,
  Service,
  Volume,
} from "cdk8s-plus-31";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/service-monitor.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import {
  MEDIA_APPLICATION_LABEL,
  MEDIA_PUBLIC_ORIGIN,
  mediaDatabaseEnvironment,
  mediaFeatureFlagEnvironment,
} from "./environment.ts";

export function createMediaApi(
  chart: Chart,
  props: { image: string; database: ISecret; bootstrap: ISecret },
) {
  if (
    !/^docker\.io\/shepherdjerred\/media@sha256:[a-f0-9]{64}$/u.test(
      props.image,
    )
  )
    throw new Error("Media requires a pinned image digest");
  const deployment = new Deployment(chart, "media-api", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    automountServiceAccountToken: false,
    podMetadata: {
      labels: { app: "media-api", [MEDIA_APPLICATION_LABEL]: "true" },
    },
    securityContext: { fsGroup: 1000 },
  });
  const securityContext = {
    user: 1000,
    group: 1000,
    ensureNonRoot: true,
    readOnlyRootFilesystem: true,
    allowPrivilegeEscalation: false,
    privileged: false,
    capabilities: { drop: [Capability.ALL] },
    seccompProfile: { type: SeccompProfileType.RUNTIME_DEFAULT },
  };
  const volumeMounts = [
    {
      path: "/tmp",
      volume: Volume.fromEmptyDir(chart, "media-api-tmp", "tmp"),
    },
  ];
  const database = mediaDatabaseEnvironment(props.database);
  deployment.addInitContainer(
    withCommonProps({
      name: "prisma-migrate",
      image: props.image,
      command: ["bunx", "--no-install", "prisma", "migrate", "deploy"],
      securityContext,
      volumeMounts,
      envVariables: { ...database, HOME: EnvValue.fromValue("/tmp") },
      resources: {
        cpu: { request: Cpu.millis(25), limit: Cpu.millis(250) },
        memory: { request: Size.mebibytes(64), limit: Size.mebibytes(256) },
      },
    }),
  );
  deployment.addContainer(
    withCommonProps({
      name: "media-api",
      image: props.image,
      command: ["bun", "src/server/index.ts"],
      securityContext,
      volumeMounts,
      ports: [{ name: "http", number: 7352 }],
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
        HOME: EnvValue.fromValue("/tmp"),
        TEMPORAL_ADDRESS: EnvValue.fromValue(
          "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
        ),
        TEMPORAL_NAMESPACE: EnvValue.fromValue("prod"),
      },
      startup: Probe.fromHttpGet("/health", {
        port: 7352,
        periodSeconds: Duration.seconds(5),
        failureThreshold: 24,
      }),
      liveness: Probe.fromHttpGet("/health", {
        port: 7352,
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
      readiness: Probe.fromHttpGet("/readyz", {
        port: 7352,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 3,
      }),
      resources: {
        cpu: { request: Cpu.millis(100), limit: Cpu.millis(1000) },
        memory: { request: Size.mebibytes(256), limit: Size.mebibytes(768) },
      },
    }),
  );
  setRevisionHistoryLimit(deployment);
  const service = new Service(chart, "media-api-service", {
    metadata: { name: "media-api", labels: { app: "media-api" } },
    selector: deployment,
    ports: [{ name: "http", port: 7352 }],
  });
  createServiceMonitor(chart, {
    name: "media-api",
    namespace: "media",
    port: "http",
    matchLabels: { app: "media-api" },
  });
  new TailscaleIngress(chart, "media-api-ingress", {
    service,
    host: "media",
    probePath: "/readyz",
  });
  return deployment;
}
