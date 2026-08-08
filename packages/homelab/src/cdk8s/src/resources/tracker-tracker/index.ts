import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Probe,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

const PORT = 3000;
const POSTGRES_SECRET_NAME =
  "trackertracker.tracker-tracker-postgresql.credentials.postgresql.acid.zalan.do";

function createDnsEgress() {
  return {
    to: [
      {
        namespaceSelector: {},
        podSelector: { matchLabels: { "k8s-app": "kube-dns" } },
      },
    ],
    ports: [
      { port: IntOrString.fromNumber(53), protocol: "UDP" },
      { port: IntOrString.fromNumber(53), protocol: "TCP" },
    ],
  };
}

export function createTrackerTrackerDeployment(chart: Chart) {
  const trackerSecrets = new OnePasswordItem(chart, "tracker-tracker-secrets", {
    spec: {
      itemPath: vaultItemPath("pp6oihrkeftnpj6zlcfoyv3d6q"),
    },
  });
  const sessionSecret = Secret.fromSecretName(
    chart,
    "tracker-tracker-session-secret",
    trackerSecrets.name,
  );
  const postgresSecret = Secret.fromSecretName(
    chart,
    "tracker-tracker-postgres-secret",
    POSTGRES_SECRET_NAME,
  );
  const dataVolume = new ZfsNvmeVolume(chart, "tracker-tracker-data-pvc", {
    storage: Size.gibibytes(8),
  });

  const deployment = new Deployment(chart, "tracker-tracker", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      ensureNonRoot: false,
      fsGroup: 1000,
    },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root":
          "The upstream image manages its runtime user; fsGroup owns the data PVC.",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "The upstream image and Next.js runtime require writable application state.",
      },
    },
    podMetadata: {
      labels: { app: "tracker-tracker" },
    },
  });

  deployment.addContainer(
    withCommonProps({
      name: "tracker-tracker",
      image: `ghcr.io/jordanlambrecht/tracker-tracker:${versions["jordanlambrecht/tracker-tracker"]}`,
      ports: [{ number: PORT, name: "http" }],
      startup: Probe.fromHttpGet("/api/health", {
        port: PORT,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 30,
      }),
      liveness: Probe.fromHttpGet("/api/health", {
        port: PORT,
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
      readiness: Probe.fromHttpGet("/api/health", {
        port: PORT,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 3,
      }),
      resources: {
        cpu: {
          request: Cpu.millis(100),
          limit: Cpu.millis(500),
        },
        memory: {
          request: Size.mebibytes(256),
          limit: Size.gibibytes(1),
        },
      },
      envVariables: {
        POSTGRES_HOST: EnvValue.fromValue("tracker-tracker-postgresql"),
        POSTGRES_PORT: EnvValue.fromValue("5432"),
        POSTGRES_DB: EnvValue.fromValue("tracker_tracker"),
        POSTGRES_USER: EnvValue.fromSecretValue({
          secret: postgresSecret,
          key: "username",
        }),
        POSTGRES_PASSWORD: EnvValue.fromSecretValue({
          secret: postgresSecret,
          key: "password",
        }),
        SESSION_SECRET: EnvValue.fromSecretValue({
          secret: sessionSecret,
          key: "password",
        }),
        SECURE_COOKIES: EnvValue.fromValue("true"),
        LOG_LEVEL: EnvValue.fromValue("info"),
      },
      volumeMounts: [
        {
          path: "/data",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "tracker-tracker-data-volume",
            dataVolume.claim,
          ),
        },
      ],
      securityContext: {
        ensureNonRoot: false,
        readOnlyRootFilesystem: false,
        allowPrivilegeEscalation: false,
      },
    }),
  );

  setRevisionHistoryLimit(deployment);

  const service = new Service(chart, "tracker-tracker-service", {
    metadata: { labels: { app: "tracker-tracker" } },
    selector: deployment,
    ports: [{ port: PORT, name: "http" }],
  });

  new TailscaleIngress(chart, "tracker-tracker-ingress", {
    service,
    host: "tracker-tracker",
    probePath: "/api/health",
  });

  new KubeNetworkPolicy(chart, "tracker-tracker-network-policy", {
    metadata: { name: "tracker-tracker-network-policy" },
    spec: {
      podSelector: { matchLabels: { app: "tracker-tracker" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "tailscale",
                },
              },
            },
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "prometheus",
                },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(PORT), protocol: "TCP" }],
        },
      ],
      egress: [
        createDnsEgress(),
        {
          to: [
            {
              podSelector: {
                matchLabels: {
                  "cluster-name": "tracker-tracker-postgresql",
                },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(5432), protocol: "TCP" }],
        },
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "media" },
              },
              podSelector: { matchLabels: { app: "qbittorrent" } },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(8080), protocol: "TCP" }],
        },
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [
            { port: IntOrString.fromNumber(80), protocol: "TCP" },
            { port: IntOrString.fromNumber(443), protocol: "TCP" },
          ],
        },
      ],
    },
  });

  return { deployment, service };
}
