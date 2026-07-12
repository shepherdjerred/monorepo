import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  Probe,
  Protocol,
  Service,
  Volume,
} from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { ApiObject, Duration, JsonPatch, Size } from "cdk8s";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export function createScryptedDeployment(chart: Chart) {
  const deployment = new Deployment(chart, "scrypted", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/host-network":
          "Required for HomeKit mDNS discovery and LAN camera/Home Hub traffic",
        "ignore-check.kube-linter.io/run-as-non-root":
          "Scrypted image runs as root under s6",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "Scrypted writes plugins, database state, and runtime files under /server/volume",
      },
    },
    podMetadata: {
      labels: { app: "scrypted" },
    },
  });

  const claim = new ZfsNvmeVolume(chart, "scrypted-pvc", {
    storage: Size.gibibytes(8),
  });

  const volume = Volume.fromPersistentVolumeClaim(
    chart,
    "scrypted-volume",
    claim.claim,
  );

  deployment.addContainer(
    withCommonProps({
      image: `ghcr.io/koush/scrypted:${versions["koush/scrypted"]}`,
      ports: [
        {
          name: "https",
          number: 10_443,
          protocol: Protocol.TCP,
        },
        {
          // Scrypted's plaintext HTTP port. The Tailscale ingress terminates TLS
          // at the tailnet edge and proxies to the backend over HTTP, so it must
          // target this port — proxying HTTP to the HTTPS-only 10443 port 502s.
          name: "http",
          number: 11_080,
          protocol: Protocol.TCP,
        },
      ],
      volumeMounts: [
        {
          path: "/server/volume",
          volume,
        },
      ],
      securityContext: {
        ensureNonRoot: false,
        readOnlyRootFilesystem: false,
        privileged: false,
        allowPrivilegeEscalation: false,
      },
      startup: Probe.fromTcpSocket({
        port: 10_443,
        periodSeconds: Duration.seconds(5),
        failureThreshold: 24,
      }),
      liveness: Probe.fromTcpSocket({
        port: 10_443,
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
      resources: {
        cpu: {
          // Scrypted was observed pegged at ~100% of a 1-core limit continuously
          // (HomeKit Secure Video transcoding + plugin hosts), which throttled it
          // enough to fail its own internal ping watchdog and the liveness probe,
          // crash-looping the HomeKit bridge (doorbell went offline) and the web
          // console. Node has ample spare CPU (27 allocatable cores); raise the
          // ceiling instead of continuing to starve it.
          request: Cpu.millis(500),
          limit: Cpu.millis(2000),
        },
        memory: {
          request: Size.mebibytes(512),
          // Also hit an OOMKill at the old 2Gi limit; doubled for HKSV clip-encoding
          // headroom.
          limit: Size.gibibytes(4),
        },
      },
    }),
  );

  ApiObject.of(deployment).addJsonPatch(
    JsonPatch.add("/spec/template/spec/hostNetwork", true),
  );

  setRevisionHistoryLimit(deployment);

  const service = new Service(chart, "scrypted-service", {
    metadata: {
      name: "scrypted",
      labels: { app: "scrypted" },
    },
    selector: deployment,
    ports: [
      { name: "https", port: 10_443 },
      { name: "http", port: 11_080 },
    ],
  });

  new TailscaleIngress(chart, "scrypted-tailscale-ingress", {
    service,
    host: "scrypted",
    // Target the plaintext HTTP port: the Tailscale ingress proxies to the
    // backend over HTTP, so pointing it at Scrypted's HTTPS-only 10443 502s.
    port: 11_080,
  });
}
