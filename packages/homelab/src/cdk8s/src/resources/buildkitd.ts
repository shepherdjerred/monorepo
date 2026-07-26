import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  ConfigMap,
  Cpu,
  Deployment,
  DeploymentStrategy,
  Namespace,
  Node,
  NodeLabelQuery,
  PersistentVolumeAccessMode,
  PersistentVolumeClaim,
  PersistentVolumeMode,
  Probe,
  Service,
  Volume,
} from "cdk8s-plus-31";
import {
  KubeNetworkPolicy,
  IntOrString,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { NVME_STORAGE_CLASS_LZ4 } from "@shepherdjerred/homelab/cdk8s/src/misc/storage-classes.ts";
import {
  CI_NODE_HOSTNAME,
  ciNodeTaintedNode,
} from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

// Plaintext gRPC port. BuildKit serves the build API here; the buildx `remote`
// driver in CI connects to it in-cluster. No TLS/mTLS: the endpoint is a
// ClusterIP Service reachable only inside the cluster (never a Tailscale/tunnel
// ingress), on a single-tenant homelab. The NetworkPolicy below restricts
// ingress to the buildkite namespace.
const PORT = 1234;

// Keep the on-disk build cache bounded well under the PVC size so BuildKit's GC
// always has headroom and the volume can never fill. 240 GiB kept of a 300 GiB
// PVC. This is large enough to retain hot production-image layers without
// letting an unbounded build cache consume the CI node.
const CACHE_PVC = Size.gibibytes(300);
const GC_KEEP_BYTES = 240 * 1024 * 1024 * 1024;

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
  // Own namespace, separate from `buildkite`: this is a long-running service,
  // not a CI batch job, and keeping it out of the CI namespace keeps that
  // separation obvious. PSA `privileged` because rootful buildkitd needs it.
  // CI reaches this at
  // buildkitd-buildkitd-service.buildkitd.svc.cluster.local:1234 (the Service
  // construct id is "buildkitd-service" under the "buildkitd" chart, and
  // resource-name hashes are disabled — the chart id is the prefix).
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
  const cache = new PersistentVolumeClaim(chart, "buildkitd-cache-liskov", {
    storageClassName: NVME_STORAGE_CLASS_LZ4,
    accessModes: [PersistentVolumeAccessMode.READ_WRITE_ONCE],
    volumeMode: PersistentVolumeMode.FILE_SYSTEM,
    storage: CACHE_PVC,
    metadata: {
      // The old buildkitd-cache claim is node-affined to torvalds. A new name
      // lets WaitForFirstConsumer bind this replacement cache on liskov
      // without taking the image builder down before the cutover.
      name: "buildkitd-cache-liskov",
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
  deployment.scheduling.attract(
    Node.labeled(NodeLabelQuery.is("kubernetes.io/hostname", CI_NODE_HOSTNAME)),
  );
  deployment.scheduling.tolerate(ciNodeTaintedNode());

  deployment.addContainer(
    withCommonProps({
      name: "buildkitd",
      image: `moby/buildkit:${versions["moby/buildkit"]}`,
      args: ["--config", "/etc/buildkit/buildkitd.toml"],
      ports: [{ name: "buildkit", number: PORT }],
      securityContext: {
        // Rootful buildkitd needs privileged for the OCI worker.
        privileged: true,
        // MUST be true here: cdk8s-plus defaults allowPrivilegeEscalation to
        // false, and the API server rejects a Deployment that sets it false
        // while privileged is true ("cannot set allowPrivilegeEscalation to
        // false and privileged to true") — which left the buildkitd Deployment
        // permanently invalid and its ArgoCD app unhealthy.
        allowPrivilegeEscalation: true,
        ensureNonRoot: false,
        readOnlyRootFilesystem: false,
      },
      resources: {
        cpu: {
          // Requests small so it costs little while idle; limit high so a real
          // parallel bake gets CPU.
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

  // The gRPC endpoint is plaintext and privileged — restrict ingress to the
  // CI job pods (buildkite namespace) so nothing else in the cluster can drive
  // builds through it. Egress stays open: buildkitd pulls base images and
  // pushes to ghcr.
  new KubeNetworkPolicy(chart, "buildkitd-ingress-netpol", {
    metadata: { name: "buildkitd-ingress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "buildkite" },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(PORT), protocol: "TCP" }],
        },
      ],
    },
  });

  return { deployment, service, config, cache };
}
