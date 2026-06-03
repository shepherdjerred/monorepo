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
          request: Cpu.millis(100),
          limit: Cpu.millis(1000),
        },
        memory: {
          request: Size.mebibytes(512),
          limit: Size.gibibytes(2),
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
    ports: [{ name: "https", port: 10_443 }],
  });

  new TailscaleIngress(chart, "scrypted-tailscale-ingress", {
    service,
    host: "scrypted",
    port: 10_443,
  });
}
