import {
  Capability,
  Cpu,
  Deployment,
  DeploymentStrategy,
  FsGroupChangePolicy,
  Probe,
  Protocol,
  SeccompProfileType,
  type PersistentVolumeClaim,
  Service,
  Volume,
} from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  LINUXSERVER_GID,
  LINUXSERVER_UID,
} from "@shepherdjerred/homelab/cdk8s/src/misc/linux-server.ts";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

const BINDERY_PORT = 8787;

/**
 * Bindery — greenfield Readarr replacement (author monitor → Prowlarr/qBit).
 *
 * Runs as UID/GID 1000 to match linuxserver qBittorrent + CWA on shared volumes.
 * Configure import mode External (or copy) to `/ingest` so CWA owns the library.
 */
export function createBinderyDeployment(
  chart: Chart,
  claims: {
    books: PersistentVolumeClaim;
    downloads: PersistentVolumeClaim;
  },
) {
  const deployment = new Deployment(chart, "bindery", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      user: LINUXSERVER_UID,
      group: LINUXSERVER_GID,
      fsGroup: LINUXSERVER_GID,
      fsGroupChangePolicy: FsGroupChangePolicy.ON_ROOT_MISMATCH,
      ensureNonRoot: true,
    },
    metadata: {
      labels: { app: "bindery" },
    },
    podMetadata: {
      labels: { app: "bindery" },
    },
  });

  const configVolume = new ZfsNvmeVolume(chart, "bindery-pvc", {
    storage: Size.gibibytes(8),
  });

  const booksVol = Volume.fromPersistentVolumeClaim(
    chart,
    "bindery-books-volume",
    claims.books,
  );
  const downloadsVol = Volume.fromPersistentVolumeClaim(
    chart,
    "bindery-downloads-volume",
    claims.downloads,
  );
  const configVol = Volume.fromPersistentVolumeClaim(
    chart,
    "bindery-config-volume",
    configVolume.claim,
  );

  // Ensure library/ + ingest/ exist before subPath mounts (shared with CWA).
  deployment.addInitContainer(
    withCommonProps({
      name: "init-books-dirs",
      image: `library/busybox:${versions["library/busybox"]}`,
      command: ["/bin/sh", "-c"],
      args: [
        "mkdir -p /books/library /books/ingest && chown -R 1000:1000 /books",
      ],
      securityContext: {
        // Needs root only to chown the fresh PVC for UID 1000 consumers.
        user: 0,
        group: 0,
        ensureNonRoot: false,
        readOnlyRootFilesystem: false,
      },
      volumeMounts: [{ path: "/books", volume: booksVol }],
      resources: {
        cpu: { request: Cpu.millis(10), limit: Cpu.millis(100) },
        memory: {
          request: Size.mebibytes(16),
          limit: Size.mebibytes(64),
        },
      },
    }),
  );

  deployment.addContainer(
    withCommonProps({
      image: `docker.io/vavallee/bindery:${versions["vavallee/bindery"]}`,
      ports: [{ number: BINDERY_PORT, name: "http", protocol: Protocol.TCP }],
      securityContext: {
        user: LINUXSERVER_UID,
        group: LINUXSERVER_GID,
        ensureNonRoot: true,
        readOnlyRootFilesystem: true,
        allowPrivilegeEscalation: false,
        capabilities: { drop: [Capability.ALL] },
        seccompProfile: { type: SeccompProfileType.RUNTIME_DEFAULT },
      },
      volumeMounts: [
        {
          path: "/config",
          volume: configVol,
        },
        {
          // Read-only: CWA owns library writes; Bindery only scans for dupes in External mode.
          path: "/books",
          volume: booksVol,
          subPath: "library",
          readOnly: true,
        },
        {
          path: "/ingest",
          volume: booksVol,
          subPath: "ingest",
        },
        {
          path: "/downloads",
          volume: downloadsVol,
        },
        {
          path: "/tmp",
          volume: Volume.fromEmptyDir(chart, "bindery-tmp", "bindery-tmp"),
        },
      ],
      resources: {
        cpu: {
          request: Cpu.millis(50),
          limit: Cpu.millis(1000),
        },
        memory: {
          request: Size.mebibytes(128),
          limit: Size.mebibytes(512),
        },
      },
      startup: Probe.fromHttpGet("/api/v1/health", {
        port: BINDERY_PORT,
        periodSeconds: Duration.seconds(5),
        failureThreshold: 30,
      }),
      liveness: Probe.fromHttpGet("/api/v1/health", {
        port: BINDERY_PORT,
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
      readiness: Probe.fromHttpGet("/api/v1/health", {
        port: BINDERY_PORT,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 3,
      }),
    }),
  );

  setRevisionHistoryLimit(deployment);

  const service = new Service(chart, "bindery-service", {
    selector: deployment,
    ports: [{ port: BINDERY_PORT }],
  });

  new TailscaleIngress(chart, "bindery-tailscale-ingress", {
    service,
    host: "bindery",
  });
}
