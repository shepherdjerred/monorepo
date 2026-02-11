import { Cpu, Deployment, DeploymentStrategy, type PersistentVolumeClaim, Service, Volume } from "cdk8s-plus-31";
import { Chart, Size } from "cdk8s";
import { LINUXSERVER_GID, withCommonLinuxServerProps } from "../../misc/linux-server.ts";
import { ZfsNvmeVolume } from "../../misc/zfs-nvme-volume.ts";
import { TailscaleIngress } from "../../misc/tailscale.ts";
import versions from "../../versions.ts";

export function createSonarrDeployment(
  chart: Chart,
  claims: {
    tv: PersistentVolumeClaim;
    downloads: PersistentVolumeClaim;
  },
) {
  const deployment = new Deployment(chart, "sonarr", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: {
      fsGroup: LINUXSERVER_GID,
    },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root": "LinuxServer.io images run as root internally",
        "ignore-check.kube-linter.io/no-read-only-root-fs": "LinuxServer.io images require writable filesystem",
      },
    },
  });

  const localPathVolume = new ZfsNvmeVolume(chart, "sonarr-pvc", {
    storage: Size.gibibytes(8),
  });

  deployment.addContainer(
    withCommonLinuxServerProps({
      image: `ghcr.io/linuxserver/sonarr:${versions["linuxserver/sonarr"]}`,
      portNumber: 8989,
      volumeMounts: [
        {
          path: "/config",
          volume: Volume.fromPersistentVolumeClaim(chart, "sonarr-volume", localPathVolume.claim),
        },
        {
          volume: Volume.fromPersistentVolumeClaim(chart, "sonarr-torrents-hdd-volume", claims.downloads),
          path: "/downloads",
        },
        {
          volume: Volume.fromPersistentVolumeClaim(chart, "sonarr-tv-hdd-volume", claims.tv),
          path: "/tv",
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

  const service = new Service(chart, "sonarr-service", {
    selector: deployment,
    ports: [{ port: 8989 }],
  });

  new TailscaleIngress(chart, "sonarr-tailscale-ingress", {
    service,
    host: "sonarr",
  });
}
