import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  type PersistentVolumeClaim,
  Service,
  Volume,
} from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  LINUXSERVER_GID,
  withCommonLinuxServerProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/linux-server.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export function createRadarrDeployment(
  chart: Chart,
  claims: {
    movies: PersistentVolumeClaim;
    downloads: PersistentVolumeClaim;
  },
) {
  const deployment = new Deployment(chart, "radarr", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      fsGroup: LINUXSERVER_GID,
    },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root":
          "LinuxServer.io images run as root internally",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "LinuxServer.io images require writable filesystem",
      },
    },
  });

  const localPathVolume = new ZfsNvmeVolume(chart, "radarr-pvc", {
    storage: Size.gibibytes(8),
  });

  deployment.addContainer(
    withCommonLinuxServerProps({
      image: `ghcr.io/linuxserver/radarr:${versions["linuxserver/radarr"]}`,
      portNumber: 7878,
      volumeMounts: [
        {
          path: "/config",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "radarr-volume",
            localPathVolume.claim,
          ),
        },
        {
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "radarr-torrents-hdd-volume",
            claims.downloads,
          ),
          path: "/downloads",
        },
        {
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "radarr-movies-hdd-volume",
            claims.movies,
          ),
          path: "/movies",
        },
      ],
      resources: {
        cpu: {
          request: Cpu.millis(50),
          limit: Cpu.millis(1000),
        },
        memory: {
          request: Size.mebibytes(256),
          limit: Size.mebibytes(768),
        },
      },
    }),
  );

  const service = new Service(chart, "radarr-service", {
    selector: deployment,
    ports: [{ port: 7878 }],
  });

  new TailscaleIngress(chart, "radarr-tailscale-ingress", {
    service,
    host: "radarr",
  });
}
