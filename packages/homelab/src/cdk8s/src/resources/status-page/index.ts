import {
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Probe,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import { withCommonProps } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/service-monitor.ts";

export function createStatusPageDeployment(chart: Chart) {
  const deployment = new Deployment(chart, "status-page", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      fsGroup: 1000,
      ensureNonRoot: false,
    },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root":
          "Status Page requires flexible user permissions for container operations",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "Status Page requires writable filesystem for SQLite database",
      },
    },
  });

  const onePasswordItem = new OnePasswordItem(chart, "status-page-1p", {
    spec: {
      itemPath: vaultItemPath("status-page-credentials"),
    },
  });

  const dataVolume = new ZfsNvmeVolume(chart, "status-page-data-pvc", {
    storage: Size.gibibytes(1),
  });

  deployment.addContainer(
    withCommonProps({
      name: "status-page-api",
      image: `ghcr.io/shepherdjerred/status-page-api:${versions["shepherdjerred/status-page-api"]}`,
      securityContext: {
        readOnlyRootFilesystem: false,
        ensureNonRoot: false,
      },
      ports: [{ number: 3000, name: "http" }],
      resources: {},
      startup: Probe.fromHttpGet("/livez", {
        port: 3000,
        periodSeconds: Duration.seconds(5),
        failureThreshold: 12,
      }),
      liveness: Probe.fromHttpGet("/livez", {
        port: 3000,
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
      readiness: Probe.fromHttpGet("/healthz", {
        port: 3000,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 3,
      }),
      volumeMounts: [
        {
          path: "/app/data",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "status-page-data-volume",
            dataVolume.claim,
          ),
        },
      ],
      envVariables: {
        DATABASE_URL: EnvValue.fromValue("file:/app/data/status.db"),
        PORT: EnvValue.fromValue("3000"),
        AUTH_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "status-page-auth-token-secret",
            onePasswordItem.name,
          ),
          key: "auth-token",
        }),
      },
    }),
  );

  const service = new Service(chart, "status-page-service", {
    metadata: {
      labels: {
        app: "status-page",
      },
    },
    selector: deployment,
    ports: [{ port: 3000, name: "http" }],
  });

  createServiceMonitor(chart, {
    name: "status-page",
    port: "http",
    path: "/metrics",
    namespace: "status-page",
    matchLabels: { app: "status-page" },
  });

  createCloudflareTunnelBinding(chart, "status-page-cf-tunnel", {
    serviceName: service.name,
    fqdn: "status-api.sjer.red",
  });
}
