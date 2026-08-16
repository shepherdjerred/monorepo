import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  Cpu,
  Deployment,
  EnvValue,
  Probe,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { llmArchiveEnvVars } from "@shepherdjerred/homelab/cdk8s/src/misc/llm-archive-env.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/service-monitor.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export const BROADCAST_PORT = 3000;
export const BROADCAST_METRICS_PORT = 9090;

export function createOpenRouterBroadcastIngestDeployment(chart: Chart) {
  const broadcastSecret = new OnePasswordItem(
    chart,
    "openrouter-broadcast-ingest-1p",
    {
      metadata: { name: "openrouter-broadcast-ingest-secrets" },
      spec: {
        // Provision this dedicated item before the chart is released. The
        // repository's offline 1Password structure check intentionally fails
        // until it exists with the required field below.
        itemPath: vaultItemPath("openrouter-broadcast-ingest"),
      },
    },
  );
  const broadcastSecretRef = Secret.fromSecretName(
    chart,
    "openrouter-broadcast-ingest-secret-ref",
    broadcastSecret.name,
  );

  const seaweedfsCredentials = new OnePasswordItem(
    chart,
    "openrouter-broadcast-seaweedfs-1p",
    {
      metadata: { name: "openrouter-broadcast-seaweedfs-credentials" },
      spec: {
        itemPath: vaultItemPath("vet52jaeh75chsalu6lulugium"),
      },
    },
  );
  const seaweedfsSecretRef = Secret.fromSecretName(
    chart,
    "openrouter-broadcast-seaweedfs-secret-ref",
    seaweedfsCredentials.name,
  );

  const deployment = new Deployment(chart, "openrouter-broadcast-ingest", {
    replicas: 1,
    podMetadata: { labels: { app: "openrouter-broadcast-ingest" } },
  });
  const container = deployment.addContainer(
    withCommonProps({
      name: "openrouter-broadcast-ingest",
      image: `ghcr.io/shepherdjerred/openrouter-broadcast-ingest:${versions["shepherdjerred/openrouter-broadcast-ingest"]}`,
      ports: [
        { name: "http", number: BROADCAST_PORT },
        { name: "metrics", number: BROADCAST_METRICS_PORT },
      ],
      envVariables: {
        PORT: EnvValue.fromValue(String(BROADCAST_PORT)),
        METRICS_PORT: EnvValue.fromValue(String(BROADCAST_METRICS_PORT)),
        OPENROUTER_BROADCAST_BEARER_TOKEN: EnvValue.fromSecretValue({
          secret: broadcastSecretRef,
          key: "OPENROUTER_BROADCAST_BEARER_TOKEN",
        }),
        OPENROUTER_BROADCAST_MAX_BODY_BYTES: EnvValue.fromValue("5242880"),
        TEMPO_OTLP_HTTP_URL: EnvValue.fromValue(
          "http://tempo.tempo.svc.cluster.local:4318/v1/traces",
        ),
        ...llmArchiveEnvVars(),
        S3_ENDPOINT: EnvValue.fromValue(
          "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
        ),
        S3_FORCE_PATH_STYLE: EnvValue.fromValue("true"),
        AWS_ACCESS_KEY_ID: EnvValue.fromSecretValue({
          secret: seaweedfsSecretRef,
          key: "SEAWEEDFS_ACCESS_KEY_ID",
        }),
        AWS_SECRET_ACCESS_KEY: EnvValue.fromSecretValue({
          secret: seaweedfsSecretRef,
          key: "SEAWEEDFS_SECRET_ACCESS_KEY",
        }),
      },
      securityContext: {
        user: 1000,
        group: 1000,
        ensureNonRoot: true,
        readOnlyRootFilesystem: true,
        allowPrivilegeEscalation: false,
      },
      resources: {
        cpu: { request: Cpu.millis(50), limit: Cpu.millis(500) },
        memory: {
          request: Size.mebibytes(128),
          limit: Size.mebibytes(512),
        },
      },
      startup: Probe.fromHttpGet("/livez", {
        port: BROADCAST_PORT,
        failureThreshold: 30,
        periodSeconds: Duration.seconds(2),
      }),
      liveness: Probe.fromHttpGet("/livez", {
        port: BROADCAST_PORT,
        periodSeconds: Duration.seconds(30),
      }),
      readiness: Probe.fromHttpGet("/readyz", {
        port: BROADCAST_PORT,
        periodSeconds: Duration.seconds(10),
      }),
    }),
  );
  container.mount(
    "/tmp",
    Volume.fromEmptyDir(chart, "openrouter-broadcast-ingest-tmp", "tmp"),
  );
  setRevisionHistoryLimit(deployment, 5);

  const service = new Service(chart, "openrouter-broadcast-ingest-service", {
    metadata: { labels: { app: "openrouter-broadcast-ingest" } },
    selector: deployment,
    ports: [
      { port: BROADCAST_PORT, name: "http" },
      { port: BROADCAST_METRICS_PORT, name: "metrics" },
    ],
  });

  createServiceMonitor(chart, {
    name: "openrouter-broadcast-ingest",
    interval: "30s",
    port: "metrics",
  });

  createCloudflareTunnelBinding(chart, "openrouter-broadcast-ingest-tunnel", {
    serviceName: service.name,
    fqdn: "openrouter-broadcast.sjer.red",
    port: BROADCAST_PORT,
    probePath: "/livez",
    publicProbePath: "/livez",
  });

  return { broadcastSecret, deployment, seaweedfsCredentials, service };
}
