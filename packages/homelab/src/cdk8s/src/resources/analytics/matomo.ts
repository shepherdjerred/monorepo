import { Duration, Size } from "cdk8s";
import type { Chart } from "cdk8s";
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
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import type { MatomoMariaDB } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/matomo-mariadb.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export type MatomoDeploymentProps = {
  mariadb: MatomoMariaDB;
};

export function createMatomoDeployment(
  chart: Chart,
  props: MatomoDeploymentProps,
) {
  const matomoVolume = new ZfsNvmeVolume(chart, "matomo-data", {
    storage: Size.gibibytes(16),
  });
  const mariadbSecret = Secret.fromSecretName(
    chart,
    "matomo-mariadb-secret",
    props.mariadb.secretItem.name,
  );

  const deployment = new Deployment(chart, "matomo", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      fsGroup: 33,
    },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "Matomo requires a writable application volume for config and plugins",
      },
    },
    podMetadata: {
      labels: { app: "matomo" },
    },
  });

  const sharedEnv = {
    MATOMO_DATABASE_HOST: EnvValue.fromValue(props.mariadb.serviceName),
    MATOMO_DATABASE_ADAPTER: EnvValue.fromValue("mysql"),
    MATOMO_DATABASE_TABLES_PREFIX: EnvValue.fromValue("matomo_"),
    MATOMO_DATABASE_USERNAME: EnvValue.fromValue(props.mariadb.username),
    MATOMO_DATABASE_PASSWORD: EnvValue.fromSecretValue({
      secret: mariadbSecret,
      key: "mariadb-password",
    }),
    MATOMO_DATABASE_DBNAME: EnvValue.fromValue(props.mariadb.databaseName),
    MATOMO_DATABASE_PORT: EnvValue.fromValue("3306"),
  };

  const dataVolume = Volume.fromPersistentVolumeClaim(
    chart,
    "matomo-data-volume",
    matomoVolume.claim,
  );

  deployment.addContainer(
    withCommonProps({
      name: "matomo",
      image: `matomo:${versions.matomo}`,
      ports: [{ name: "http", number: 80 }],
      envVariables: sharedEnv,
      volumeMounts: [{ path: "/var/www/html", volume: dataVolume }],
      resources: {
        cpu: {
          request: Cpu.millis(100),
          limit: Cpu.millis(2000),
        },
        memory: {
          request: Size.mebibytes(512),
          limit: Size.gibibytes(2),
        },
      },
      startup: Probe.fromHttpGet("/", {
        port: 80,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 60,
      }),
      liveness: Probe.fromHttpGet("/", {
        port: 80,
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
      readiness: Probe.fromHttpGet("/", {
        port: 80,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 3,
      }),
    }),
  );

  // Disable browser-triggered archiving and keep archive work in the same Pod
  // so the RWO application volume is never mounted by a second Pod, while
  // still following Matomo's recommended five-minute cadence.
  deployment.addContainer(
    withCommonProps({
      name: "matomo-archive",
      image: `matomo:${versions.matomo}`,
      command: ["/bin/sh", "-c"],
      args: [
        "while true; do until php /var/www/html/console config:set --section=General --key=enable_browser_archiving_triggering --value=0 && php /var/www/html/console config:set --section=General --key=browser_archiving_disabled_enforce --value=1; do sleep 30; done; php /var/www/html/console core:archive; sleep 300; done",
      ],
      envVariables: sharedEnv,
      volumeMounts: [{ path: "/var/www/html", volume: dataVolume }],
      resources: {
        cpu: {
          request: Cpu.millis(50),
          limit: Cpu.millis(500),
        },
        memory: {
          request: Size.mebibytes(128),
          limit: Size.mebibytes(512),
        },
      },
    }),
  );

  setRevisionHistoryLimit(deployment);

  const service = new Service(chart, "matomo-service", {
    selector: deployment,
    metadata: {
      labels: { app: "matomo" },
    },
    ports: [{ port: 80, name: "http" }],
  });

  new TailscaleIngress(chart, "matomo-tailscale-ingress", {
    service,
    host: "matomo",
  });

  createCloudflareTunnelBinding(chart, "matomo-cf-tunnel", {
    serviceName: service.name,
    subdomain: "matomo",
    port: 80,
  });

  new KubeNetworkPolicy(chart, "matomo-netpol", {
    metadata: { name: "matomo-netpol" },
    spec: {
      podSelector: { matchLabels: { app: "matomo" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "tailscale" },
              },
            },
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "cloudflare-tunnel",
                },
              },
            },
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "prometheus" },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(80), protocol: "TCP" }],
        },
      ],
      egress: [
        {
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
        },
        {
          to: [
            {
              podSelector: {
                matchLabels: {
                  "app.kubernetes.io/instance": "matomo-mariadb",
                  "app.kubernetes.io/name": "mariadb",
                  "app.kubernetes.io/component": "primary",
                },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(3306), protocol: "TCP" }],
        },
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "postal" },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(25), protocol: "TCP" }],
        },
      ],
    },
  });

  new KubeNetworkPolicy(chart, "matomo-mariadb-netpol", {
    metadata: { name: "matomo-mariadb-netpol" },
    spec: {
      podSelector: {
        matchLabels: {
          "app.kubernetes.io/instance": "matomo-mariadb",
          "app.kubernetes.io/name": "mariadb",
          "app.kubernetes.io/component": "primary",
        },
      },
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [{ podSelector: { matchLabels: { app: "matomo" } } }],
          ports: [{ port: IntOrString.fromNumber(3306), protocol: "TCP" }],
        },
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "prometheus" },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(9104), protocol: "TCP" }],
        },
      ],
    },
  });

  return { deployment, service };
}
