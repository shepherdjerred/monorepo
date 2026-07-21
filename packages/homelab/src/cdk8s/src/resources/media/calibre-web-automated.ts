import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  Probe,
  type PersistentVolumeClaim,
  Service,
  Volume,
} from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  LINUXSERVER_GID,
  LINUXSERVER_KUBE_LINTER_ANNOTATIONS,
  withCommonLinuxServerProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/linux-server.ts";
import { withCommonProps } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { setRevisionHistoryLimit } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

const CWA_PORT = 8083;

/**
 * Calibre-Web Automated — ebook library, ingest, convert, EPUB Fixer, Auto-Send.
 *
 * SMTP / Kindle Auto-Send is configured in the CWA UI (Postal:
 * postal-postal-smtp-service.postal:25). Amazon approved-sender allowlist is
 * one-time operator setup — see the ebook-stack plan doc.
 *
 * Volume layout on the shared books PVC (created by Bindery init):
 *   library/ → /calibre-library
 *   ingest/  → /cwa-book-ingest  (Bindery External destination)
 */
export function createCalibreWebAutomatedDeployment(
  chart: Chart,
  claims: {
    books: PersistentVolumeClaim;
  },
) {
  const deployment = new Deployment(chart, "cwa", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      fsGroup: LINUXSERVER_GID,
    },
    metadata: {
      labels: { app: "cwa" },
      annotations: { ...LINUXSERVER_KUBE_LINTER_ANNOTATIONS },
    },
    // Pod label used by Postal SMTP NetworkPolicy (media + app=cwa only).
    podMetadata: {
      labels: { app: "cwa" },
    },
  });

  const configVolume = new ZfsNvmeVolume(chart, "cwa-pvc", {
    storage: Size.gibibytes(8),
  });

  const booksVol = Volume.fromPersistentVolumeClaim(
    chart,
    "cwa-books-volume",
    claims.books,
  );

  // Same layout init as Bindery so CWA can start before Bindery on a fresh PVC.
  deployment.addInitContainer(
    withCommonProps({
      name: "init-books-dirs",
      image: `library/busybox:${versions["library/busybox"]}`,
      command: ["/bin/sh", "-c"],
      args: [
        "mkdir -p /books/library /books/ingest && chown -R 1000:1000 /books",
      ],
      securityContext: {
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
    withCommonLinuxServerProps({
      image: `docker.io/crocodilestick/calibre-web-automated:${versions["crocodilestick/calibre-web-automated"]}`,
      portNumber: CWA_PORT,
      volumeMounts: [
        {
          path: "/config",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "cwa-config-volume",
            configVolume.claim,
          ),
        },
        {
          path: "/calibre-library",
          volume: booksVol,
          subPath: "library",
        },
        {
          path: "/cwa-book-ingest",
          volume: booksVol,
          subPath: "ingest",
        },
      ],
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
      // CWA is Calibre-Web under the hood; login page is a stable liveness signal.
      startup: Probe.fromHttpGet("/", {
        port: CWA_PORT,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 36,
      }),
      liveness: Probe.fromHttpGet("/", {
        port: CWA_PORT,
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
      readiness: Probe.fromHttpGet("/", {
        port: CWA_PORT,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 3,
      }),
    }),
  );

  setRevisionHistoryLimit(deployment);

  const service = new Service(chart, "cwa-service", {
    selector: deployment,
    ports: [{ port: CWA_PORT }],
  });

  new TailscaleIngress(chart, "cwa-tailscale-ingress", {
    service,
    host: "cwa",
  });
}
