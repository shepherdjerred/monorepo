import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  ConfigMap,
  Cpu,
  Deployment,
  DeploymentStrategy,
  Namespace,
  PersistentVolumeAccessMode,
  PersistentVolumeClaim,
  PersistentVolumeMode,
  Probe,
  Service,
  Volume,
} from "cdk8s-plus-31";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { NVME_STORAGE_CLASS_LZ4 } from "@shepherdjerred/homelab/cdk8s/src/misc/storage-classes.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

// Plaintext gRPC port. BuildKit serves the build API here; the buildx `remote`
// driver in CI connects to it in-cluster. No TLS/mTLS: the endpoint is a
// ClusterIP Service reachable only inside the cluster (never a Tailscale/tunnel
// ingress), on a single-tenant homelab. A NetworkPolicy restricting ingress to
// the buildkite namespace is a sensible follow-up hardening.
const PORT = 1234;

// Keep the on-disk build cache bounded well under the PVC size so BuildKit's GC
// always has headroom and the volume can never fill. 100 GiB kept of a 150 GiB
// PVC.
const CACHE_PVC = Size.gibibytes(150);
const GC_KEEP_BYTES = 100 * 1024 * 1024 * 1024;

// buildkitd.toml: listen on tcp for the remote driver, and cap the cache with a
// GC policy so the compressed ZFS volume stays bounded (the whole point vs the
// old unbounded Dagger engine cache that froze the node).
const BUILDKITD_TOML = `
debug = false

[grpc]
  address = [ "tcp://0.0.0.0:${String(PORT)}" ]

[worker.oci]
  enabled = true
  gc = true
  # Reserve the kept-cache floor; GC prunes above it. Keeps the volume bounded.
  [[worker.oci.gcpolicy]]
    keepBytes = ${String(GC_KEEP_BYTES)}
    keepDuration = 0
    all = true

[worker.containerd]
  enabled = false
`;

export function createBuildkitdDeployment(chart: Chart) {
  // Own namespace, NOT the Kueue-managed `buildkite` namespace: a long-running
  // Deployment there would be intercepted by Kueue admission (which is for
  // batch jobs, not services). PSA `privileged` because rootful buildkitd needs
  // it. CI reaches this at buildkitd.buildkitd.svc.cluster.local:1234.
  new Namespace(chart, "buildkitd-namespace", {
    metadata: {
      name: "buildkitd",
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
        "pod-security.kubernetes.io/audit": "privileged",
        "pod-security.kubernetes.io/warn": "privileged",
      },
    },
  });

  const config = new ConfigMap(chart, "buildkitd-config", {
    data: { "buildkitd.toml": BUILDKITD_TOML },
  });

  // Rebuildable cache — explicitly excluded from Velero backup (a cache is
  // pointless to restore, and it can be large).
  const cache = new PersistentVolumeClaim(chart, "buildkitd-cache", {
    storageClassName: NVME_STORAGE_CLASS_LZ4,
    accessModes: [PersistentVolumeAccessMode.READ_WRITE_ONCE],
    volumeMode: PersistentVolumeMode.FILE_SYSTEM,
    storage: CACHE_PVC,
    metadata: {
      name: "buildkitd-cache",
      labels: {
        "velero.io/backup": "disabled",
        "velero.io/exclude-from-backup": "true",
      },
    },
  });

  const deployment = new Deployment(chart, "buildkitd", {
    replicas: 1,
    // A single writer owns the RWO cache volume; never run two at once.
    strategy: DeploymentStrategy.recreate(),
  });

  deployment.addContainer(
    withCommonProps({
      name: "buildkitd",
      image: `moby/buildkit:${versions["moby/buildkit"]}`,
      args: ["--config", "/etc/buildkit/buildkitd.toml"],
      ports: [{ name: "buildkit", number: PORT }],
      securityContext: {
        // Rootful buildkitd needs privileged for the OCI worker.
        privileged: true,
        ensureNonRoot: false,
        readOnlyRootFilesystem: false,
      },
      resources: {
        cpu: {
          // Requests small so it costs little while idle; limit high so a real
          // parallel bake gets CPU. Not Kueue-managed (own namespace).
          request: Cpu.millis(500),
          limit: Cpu.units(8),
        },
        memory: {
          request: Size.gibibytes(1),
          limit: Size.gibibytes(12),
        },
      },
      // A TCP check on the gRPC port is a sufficient, cheap readiness signal.
      liveness: Probe.fromTcpSocket({ port: PORT }),
      readiness: Probe.fromTcpSocket({ port: PORT }),
      volumeMounts: [
        {
          path: "/var/lib/buildkit",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "buildkitd-cache-volume",
            cache,
          ),
        },
        {
          path: "/etc/buildkit",
          volume: Volume.fromConfigMap(
            chart,
            "buildkitd-config-volume",
            config,
          ),
        },
      ],
    }),
  );

  setRevisionHistoryLimit(deployment);

  const service = new Service(chart, "buildkitd-service", {
    selector: deployment,
    ports: [{ port: PORT, name: "buildkit" }],
  });

  return { deployment, service, config, cache };
}
