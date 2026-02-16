import { Cpu, Deployment, DeploymentStrategy, Service, Volume } from "cdk8s-plus-31";
import { Chart, Size } from "cdk8s";
import { LINUXSERVER_GID, withCommonLinuxServerProps } from "../../misc/linux-server.ts";
import { ZfsNvmeVolume } from "../../misc/zfs-nvme-volume.ts";
import { TailscaleIngress } from "../../misc/tailscale.ts";
import versions from "../../versions.ts";

export function createMaintainerrDeployment(chart: Chart) {
  const deployment = new Deployment(chart, "maintainerr", {
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

  const localPathVolume = new ZfsNvmeVolume(chart, "maintainerr-pvc", {
    storage: Size.gibibytes(8),
  });

  deployment.addContainer(
    withCommonLinuxServerProps({
      image: `ghcr.io/jorenn92/maintainerr:${versions["jorenn92/maintainerr"]}`,
      portNumber: 6246,
      volumeMounts: [
        {
          path: "/opt/data",
          volume: Volume.fromPersistentVolumeClaim(chart, "maintainerr-volume", localPathVolume.claim),
        },
      ],
      resources: {
        cpu: {
          request: Cpu.millis(50),
          limit: Cpu.millis(1000),
        },
        memory: {
          request: Size.mebibytes(256),
          limit: Size.mebibytes(512),
        },
      },
    }),
  );

  const service = new Service(chart, "maintainerr-service", {
    selector: deployment,
    ports: [{ port: 6246 }],
  });

  new TailscaleIngress(chart, "maintainerr-tailscale-ingress", {
    service,
    host: "maintainerr",
  });
}
