import { Duration, Size } from "cdk8s";
import type { Chart } from "cdk8s";
import {
  ConfigMap,
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

const archiveCommand = [
  "set -e;",
  "until test -f /var/www/html/config/config.ini.php; do sleep 30; done;",
  "php /var/www/html/console config:set",
  "'General.enable_browser_archiving_triggering=0'",
  "'General.browser_archiving_disabled_enforce=1'",
  "'General.assume_secure_protocol=1'",
  "'General.force_ssl=1'",
  "'General.proxy_ip_read_last_in_list=0'",
  ";",
  "if ! grep -Fq 'HTTP_CF_CONNECTING_IP' /var/www/html/config/config.ini.php; then",
  "php /var/www/html/console config:set 'General.proxy_client_headers[]=\"HTTP_CF_CONNECTING_IP\"';",
  "fi;",
  "if ! grep -Fq 'HTTP_X_FORWARDED_HOST' /var/www/html/config/config.ini.php; then",
  "php /var/www/html/console config:set 'General.proxy_host_headers[]=\"HTTP_X_FORWARDED_HOST\"';",
  "fi;",
  "if ! grep -Fq 'matomo.sjer.red' /var/www/html/config/config.ini.php; then",
  "php /var/www/html/console config:set 'General.trusted_hosts[]=\"matomo.sjer.red\"';",
  "fi;",
  "while true; do",
  "php /var/www/html/console core:archive || exit 1;",
  "sleep 300;",
  "done",
].join(" ");

const publicReadyMarker = "/var/www/html/.matomo-public-ready";

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
  const publicGateConfig = new ConfigMap(chart, "matomo-public-gate-config", {
    data: {
      "nginx.conf": `events {}
http {
  server {
    listen 8080;
    location / {
      if (!-f ${publicReadyMarker}) { return 503; }
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Host $host;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
      proxy_pass http://127.0.0.1:80;
    }
  }
}
`,
    },
  });
  const publicGateConfigVolume = Volume.fromConfigMap(
    chart,
    "matomo-public-gate-config-volume",
    publicGateConfig,
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
      startup: Probe.fromTcpSocket({
        port: 80,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 60,
      }),
      liveness: Probe.fromTcpSocket({
        port: 80,
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
      readiness: Probe.fromTcpSocket({
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
      args: [archiveCommand],
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

  // Keep the Matomo process healthy and available through Tailscale during
  // first-run setup, but make the Cloudflare-facing port fail closed until
  // the operator creates the marker after the installer and privacy settings
  // are complete. This decouples Argo health from the manual cutover gate.
  deployment.addContainer(
    withCommonProps({
      name: "matomo-public-gate",
      image: `nginx:${versions["library/nginx"]}`,
      command: ["nginx"],
      args: ["-g", "daemon off;", "-c", "/etc/nginx/nginx.conf"],
      ports: [{ name: "public-http", number: 8080 }],
      volumeMounts: [
        { path: "/etc/nginx", volume: publicGateConfigVolume },
        { path: "/var/www/html", volume: dataVolume, readOnly: true },
      ],
      resources: {
        cpu: {
          request: Cpu.millis(10),
          limit: Cpu.millis(100),
        },
        memory: {
          request: Size.mebibytes(16),
          limit: Size.mebibytes(64),
        },
      },
    }),
  );

  setRevisionHistoryLimit(deployment);

  // Matomo's process Service remains available through Tailscale for setup.
  // The public Service targets the fail-closed nginx gate instead of the
  // installer, and only proxies after the operator creates publicReadyMarker.
  const service = new Service(chart, "matomo-service", {
    selector: deployment,
    metadata: {
      labels: { app: "matomo" },
    },
    ports: [{ port: 80, name: "http" }],
  });
  const publicService = new Service(chart, "matomo-public-service", {
    selector: deployment,
    metadata: {
      labels: { app: "matomo" },
    },
    ports: [{ port: 80, targetPort: 8080, name: "http" }],
  });

  new TailscaleIngress(chart, "matomo-tailscale-ingress", {
    service,
    host: "matomo",
  });

  createCloudflareTunnelBinding(chart, "matomo-cf-tunnel", {
    serviceName: publicService.name,
    subdomain: "matomo",
    port: 80,
    publicProbePath:
      "/matomo.php?module=API&method=API.getMatomoVersion&format=json",
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
          ],
          ports: [{ port: IntOrString.fromNumber(80), protocol: "TCP" }],
        },
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "cloudflare-tunnel",
                },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(8080), protocol: "TCP" }],
        },
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "prometheus" },
              },
            },
          ],
          ports: [
            { port: IntOrString.fromNumber(80), protocol: "TCP" },
            { port: IntOrString.fromNumber(8080), protocol: "TCP" },
          ],
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
