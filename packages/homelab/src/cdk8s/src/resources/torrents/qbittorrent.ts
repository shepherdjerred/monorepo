import {
  ConfigMap,
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  type PersistentVolumeClaim,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { withCommonLinuxServerProps } from "@shepherdjerred/homelab/cdk8s/src/misc/linux-server.ts";
import {
  withCommonProps,
  setRevisionHistoryLimit,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/service-monitor.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";

const CURRENT_FILENAME = fileURLToPath(import.meta.url);
const CURRENT_DIRNAME = path.dirname(CURRENT_FILENAME);

export function createQBitTorrentDeployment(
  chart: Chart,
  claims: {
    downloads: PersistentVolumeClaim;
  },
) {
  const item = new OnePasswordItem(chart, "mullvad", {
    spec: {
      itemPath:
        "vaults/v64ocnykdqju4ui6j6pua56xw4/items/74rqjncejp7rpgelymnmul5ssm",
    },
  });

  const qBitTorrentItem = new OnePasswordItem(chart, "qbittorrent-item", {
    spec: {
      itemPath:
        "vaults/v64ocnykdqju4ui6j6pua56xw4/items/2bbw7oe6s5clygljwmeflwtovm",
    },
  });

  const deployment = new Deployment(chart, "qbittorrent", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/privileged-container":
          "Gluetun VPN container requires privileged for network setup",
        "ignore-check.kube-linter.io/privilege-escalation-container":
          "Required when privileged is true",
        "ignore-check.kube-linter.io/run-as-non-root":
          "Gluetun and LinuxServer images require root",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "VPN and torrent client require writable filesystem",
      },
    },
  });

  const localPathVolume = new ZfsNvmeVolume(chart, "qbittorrent-pvc", {
    storage: Size.gibibytes(32),
  });

  // The qBittorrent config PVC, shared between the seed init container and the
  // main container so both mount the same `/config`.
  const configVolume = Volume.fromPersistentVolumeClaim(
    chart,
    "qbittorrent-volume",
    localPathVolume.claim,
  );

  // Config-as-code: a committed baseline qBittorrent.conf seeded into the PVC on
  // first boot. qBittorrent rewrites its conf at runtime, so this is a
  // seed-if-absent (not enforce): on an existing PVC the live conf is left
  // untouched; on a fresh PVC (disaster recovery / new deploy) the committed
  // settings are restored. The WebUI password hash is deliberately NOT in the
  // committed file — qBittorrent generates a temporary password (logged) on a
  // fresh start, which is then reset.
  const qbittorrentConfig = new ConfigMap(chart, "qbittorrent-config", {
    metadata: {
      name: "qbittorrent-config",
    },
  });
  // addDirectory reads the committed dir synchronously at synth time and adds
  // each file as a ConfigMap key, so the key is exactly "qBittorrent.conf".
  qbittorrentConfig.addDirectory(
    path.join(CURRENT_DIRNAME, "..", "configs", "qbittorrent"),
  );
  const seedVolume = Volume.fromConfigMap(
    chart,
    "qbittorrent-config-volume",
    qbittorrentConfig,
  );

  // Runs as root so it can write to a fresh, root-owned PVC during disaster
  // recovery. Seeding (the cp) is conditional — seed-if-absent so a live conf
  // is never clobbered — but the ownership repair (chown -R) runs every
  // reconcile, idempotently: an existing PVC whose /config/qBittorrent is still
  // root:root (e.g. from a partial restore or an earlier seed attempt) gets
  // handed to the LinuxServer PUID/PGID (1000:1000) so qBittorrent can create
  // sibling log/lock/backup files there.
  deployment.addInitContainer({
    name: "qbittorrent-config-seed",
    image: `ghcr.io/linuxserver/qbittorrent:${versions["linuxserver/qbittorrent"]}`,
    command: [
      "/bin/sh",
      "-c",
      "mkdir -p /config/qBittorrent && if [ ! -f /config/qBittorrent/qBittorrent.conf ]; then cp /seed/qBittorrent.conf /config/qBittorrent/qBittorrent.conf; fi && chown -R 1000:1000 /config/qBittorrent && chmod 600 /config/qBittorrent/qBittorrent.conf",
    ],
    resources: {},
    securityContext: {
      ensureNonRoot: false,
      user: 0,
      group: 0,
      privileged: false,
      allowPrivilegeEscalation: false,
      readOnlyRootFilesystem: true,
    },
    volumeMounts: [
      { path: "/config", volume: configVolume },
      { path: "/seed", volume: seedVolume },
    ],
  });

  deployment.addContainer(
    withCommonProps({
      // Deliberately BestEffort (no requests/limits) — negligible or
      // non-critical usage; see the 2026-06-12 right-sizing plan.
      resources: {},
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
          key: "PRIVATE_KEY",
        }),
        WIREGUARD_PRESHARED_KEY: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "airvpn-preshared-key",
            item.name,
          ),
          key: "PRESHARED_KEY",
        }),
        WIREGUARD_ADDRESSES: EnvValue.fromValue(
          "10.154.174.240/32,fd7d:76ee:e68f:a993:af57:e79c:b39d:9dde/128",
        ),
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
          volume: configVolume,
        },
        {
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "qbittorrent-hdd-volume",
            claims.downloads,
          ),
          path: "/downloads",
        },
      ],
    }),
  );

  // Add Prometheus exporter for qBittorrent metrics
  deployment.addContainer(
    withCommonProps({
      // Deliberately BestEffort (no requests/limits) — negligible or
      // non-critical usage; see the 2026-06-12 right-sizing plan.
      resources: {},
      name: "qbittorrent-exporter",
      image: `ghcr.io/esanchezm/prometheus-qbittorrent-exporter:${versions["esanchezm/prometheus-qbittorrent-exporter"]}`,
      ports: [{ number: 17_871, name: "metrics" }],
      securityContext: {
        ensureNonRoot: true,
        readOnlyRootFilesystem: true,
        user: 65_534, // nobody user
        group: 65_534,
      },
      envVariables: {
        QBITTORRENT_HOST: EnvValue.fromValue("localhost"),
        QBITTORRENT_PORT: EnvValue.fromValue("8080"),
        QBITTORRENT_USER: EnvValue.fromValue("admin"),
        QBITTORRENT_PASS: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "qbittorrent-password",
            qBitTorrentItem.name,
          ),
          key: "password",
        }),
        EXPORTER_PORT: EnvValue.fromValue("17871"),
        EXPORTER_LOG_LEVEL: EnvValue.fromValue("INFO"),
      },
    }),
  );

  setRevisionHistoryLimit(deployment);

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
    ports: [{ port: 17_871, name: "metrics" }],
  });

  new TailscaleIngress(chart, "qbittorrent-tailscale-ingress", {
    service,
    host: "qbittorrent",
  });

  // Create ServiceMonitor for Prometheus to scrape qBittorrent metrics
  createServiceMonitor(chart, { name: "qbittorrent", interval: "60s" });
}
