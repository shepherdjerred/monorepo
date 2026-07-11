import {
  ConfigMap,
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  type PersistentVolumeClaim,
  Probe,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
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

  // Config-as-code: the committed qBittorrent.conf is the source of truth.
  // - Fresh PVC (no live conf): seed it from the committed file.
  // - Existing PVC: assert the live conf still MATCHES the committed declaration
  //   (see check-config-drift.sh). Any drift on a managed key fails the init
  //   container so the operator must reconcile by committing the change — config
  //   drift is never silently tolerated.
  // Only keys we declare are enforced; keys qBittorrent writes on its own
  // (WebUI\Password_PBKDF2, Network\Cookies, ...) are ignored, so the guard never
  // false-positives on the app's runtime churn. A few engine-owned keys that DO
  // appear in the committed seed (Meta\MigrationVersion, bumped by the image on a
  // qBittorrent upgrade) are also excluded from enforcement so a version bump
  // can't crash-loop the pod — see the exclusion list in check-config-drift.sh.
  // The WebUI password hash is
  // deliberately NOT in the committed file — qBittorrent generates a temporary
  // password (logged) on a fresh start, which is then reset.
  const qbittorrentConfig = new ConfigMap(chart, "qbittorrent-config", {
    metadata: {
      name: "qbittorrent-config",
    },
  });
  // addDirectory reads the committed dir synchronously at synth time and adds
  // each file as a ConfigMap key: "qBittorrent.conf" (the seed) and
  // "check-config-drift.sh" (the fail-on-drift guard). Both are mounted at /seed.
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
      // `set -e` propagates the drift guard's non-zero exit so the init
      // container (and thus the pod) fails fast when the live conf has drifted
      // from the committed declaration.
      [
        "set -e",
        "mkdir -p /config/qBittorrent",
        "if [ ! -f /config/qBittorrent/qBittorrent.conf ]; then",
        "  cp /seed/qBittorrent.conf /config/qBittorrent/qBittorrent.conf",
        "else",
        "  sh /seed/check-config-drift.sh /seed/qBittorrent.conf /config/qBittorrent/qBittorrent.conf",
        "fi",
        "chown -R 1000:1000 /config/qBittorrent",
        "chmod 600 /config/qBittorrent/qBittorrent.conf",
      ].join("\n"),
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
      // On a cold start (pod/node reboot), qbittorrent-nox loads and rechecks
      // resume data for every tracked torrent before it binds the WebUI port,
      // which can take well over the cdk8s-plus default 30s startup window
      // (period=10s, failureThreshold=3). Kubelet was killing the container
      // (SIGKILL, exit 137) before it ever came up, crash-looping forever.
      //
      // 2026-07-11: even the original 5-minute runway proved too short while the
      // node was recovering from the CI-storm freezes — the linuxserver s6 init
      // alone took ~2min under degraded IO and the probe killed the container 4x
      // in a row (each kill a dirty shutdown, making the next start slower — the
      // same kill-during-recovery loop the dagger engine had). 15 minutes: on a
      // healthy node startup finishes in ~3min so the extra window costs
      // nothing, and under IO starvation the kill is the last thing that helps.
      startup: Probe.fromTcpSocket({
        port: 8080,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 90,
      }),
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
        // Must match the qBittorrent WebUI username (WebUI\Username in the
        // /config PVC), otherwise every scrape fails auth, reports
        // qbittorrent_up=0, and bans the pod's localhost IP for repeated bad logins.
        QBITTORRENT_USER: EnvValue.fromValue("jerred"),
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
