import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Deployment, DeploymentStrategy, Service, Volume } from "cdk8s-plus-31";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import {
  LINUXSERVER_GID,
  withCommonLinuxServerProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/linux-server.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export function createSyncthingDeployment(chart: Chart) {
  const deployment = new Deployment(chart, "syncthing", {
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

  const configLocalPathVolume = new ZfsNvmeVolume(chart, "syncthing-config", {
    storage: Size.gibibytes(8),
  });

  const dataLocalPathVolume = new ZfsNvmeVolume(chart, "syncthing-data", {
    storage: Size.gibibytes(64),
  });

  deployment.addContainer(
    withCommonLinuxServerProps({
      image: `ghcr.io/linuxserver/syncthing:${versions["linuxserver/syncthing"]}`,
      portNumber: 8384,
      volumeMounts: [
        {
          path: "/config",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "syncthing-volume",
            configLocalPathVolume.claim,
          ),
        },
        {
          path: "/sync",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "syncthing-data-volume",
            dataLocalPathVolume.claim,
          ),
        },
      ],
    }),
  );

  const service = new Service(chart, "syncthing-service", {
    selector: deployment,
    ports: [{ port: 8384 }],
  });

  new TailscaleIngress(chart, "syncthing-tailscale-ingress", {
    service,
    host: "syncthing",
  });
}
