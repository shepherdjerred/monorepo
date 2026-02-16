import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  type PersistentVolumeClaim,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import { Chart, Size } from "cdk8s";
import { withCommonLinuxServerProps } from "../../misc/linux-server.ts";
import { withCommonProps } from "../../misc/common.ts";
import { ZfsNvmeVolume } from "../../misc/zfs-nvme-volume.ts";
import { TailscaleIngress } from "../../misc/tailscale.ts";
import versions from "../../versions.ts";
import { createServiceMonitor } from "../../misc/service-monitor.ts";
import { OnePasswordItem } from "../../../generated/imports/onepassword.com.ts";

export function createQBitTorrentDeployment(
  chart: Chart,
  claims: {
    downloads: PersistentVolumeClaim;
  },
) {
  const item = new OnePasswordItem(chart, "mullvad", {
    spec: {
      itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/74rqjncejp7rpgelymnmul5ssm",
    },
  });

  const qBitTorrentItem = new OnePasswordItem(chart, "qbittorrent-item", {
    spec: {
      itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/2bbw7oe6s5clygljwmeflwtovm",
    },
  });

  const deployment = new Deployment(chart, "qbittorrent", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/privileged-container":
          "Gluetun VPN container requires privileged for network setup",
        "ignore-check.kube-linter.io/privilege-escalation-container": "Required when privileged is true",
        "ignore-check.kube-linter.io/run-as-non-root": "Gluetun and LinuxServer images require root",
        "ignore-check.kube-linter.io/no-read-only-root-fs": "VPN and torrent client require writable filesystem",
      },
    },
  });

  const localPathVolume = new ZfsNvmeVolume(chart, "qbittorrent-pvc", {
    storage: Size.gibibytes(16),
  });

  deployment.addContainer(
    withCommonProps({
      name: "gluetun",
      image: `ghcr.io/qdm12/gluetun:${versions["qdm12/gluetun"]}`,
      // TODO: replace this with capability to run as non-root
      // this is mostly required right now to setup the VPN
      securityContext: {
        privileged: true,
        allowPrivilegeEscalation: true,
        ensureNonRoot: false,
        readOnlyRootFilesystem: false,
      },
      envVariables: {
        DOT: EnvValue.fromValue("off"),
        VPN_INTERFACE: EnvValue.fromValue("wg0"),
        UPDATER_PERIOD: EnvValue.fromValue("24h"),
        VPN_SERVICE_PROVIDER: EnvValue.fromValue("airvpn"),
        VPN_TYPE: EnvValue.fromValue("wireguard"),
        WIREGUARD_PRIVATE_KEY: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "airvpn-private-key", item.name),
          key: "private-key",
        }),
        WIREGUARD_PRESHARED_KEY: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "airvpn-preshared-key", item.name),
          key: "preshared-key",
        }),
        WIREGUARD_ADDRESSES: EnvValue.fromValue("10.154.174.240/32,fd7d:76ee:e68f:a993:af57:e79c:b39d:9dde/128"),
        FIREWALL_VPN_INPUT_PORTS: EnvValue.fromValue("17826"),
      },
    }),
  );
  deployment.addContainer(
    withCommonLinuxServerProps({
      name: "qbittorrent",
      image: `ghcr.io/linuxserver/qbittorrent:${versions["linuxserver/qbittorrent"]}`,
      portNumber: 8080,
      resources: {
        memory: {
          request: Size.gibibytes(1),
          limit: Size.gibibytes(4),
        },
        cpu: {
          request: Cpu.millis(100),
          limit: Cpu.millis(2000),
        },
      },
      volumeMounts: [
        {
          path: "/config",
          volume: Volume.fromPersistentVolumeClaim(chart, "qbittorrent-volume", localPathVolume.claim),
        },
        {
          volume: Volume.fromPersistentVolumeClaim(chart, "qbittorrent-hdd-volume", claims.downloads),
          path: "/downloads",
        },
      ],
    }),
  );

  // Add Prometheus exporter for qBittorrent metrics
  deployment.addContainer(
    withCommonProps({
      name: "qbittorrent-exporter",
      image: `ghcr.io/esanchezm/prometheus-qbittorrent-exporter:${versions["esanchezm/prometheus-qbittorrent-exporter"]}`,
      ports: [{ number: 17871, name: "metrics" }],
      securityContext: {
        ensureNonRoot: true,
        readOnlyRootFilesystem: true,
        user: 65534, // nobody user
        group: 65534,
      },
      envVariables: {
        QBITTORRENT_HOST: EnvValue.fromValue("localhost"),
        QBITTORRENT_PORT: EnvValue.fromValue("8080"),
        QBITTORRENT_USER: EnvValue.fromValue("admin"),
        QBITTORRENT_PASS: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(chart, "qbittorrent-password", qBitTorrentItem.name),
          key: "password",
        }),
        EXPORTER_PORT: EnvValue.fromValue("17871"),
        EXPORTER_LOG_LEVEL: EnvValue.fromValue("INFO"),
      },
    }),
  );

  const service = new Service(chart, "qbittorrent-service", {
    selector: deployment,
    // required to allow TailScale to expose the service
    metadata: {
      annotations: {
        "metallb.universe.tf/allow-shared-ip": "gluetun",
      },
      labels: {
        app: "qbittorrent",
      },
    },
    ports: [{ port: 8080 }],
  });

  new Service(chart, "qbittorrent-metrics-service", {
    selector: deployment,
    metadata: {
      labels: {
        app: "qbittorrent",
      },
    },
    ports: [{ port: 17871, name: "metrics" }],
  });

  new TailscaleIngress(chart, "qbittorrent-tailscale-ingress", {
    service,
    host: "qbittorrent",
  });

  // Create ServiceMonitor for Prometheus to scrape qBittorrent metrics
  createServiceMonitor(chart, { name: "qbittorrent", interval: "60s" });
}
