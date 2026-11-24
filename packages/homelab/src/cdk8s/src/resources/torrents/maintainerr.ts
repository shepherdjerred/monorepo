import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  Service,
  Volume,
} from "cdk8s-plus-31";
import { tailnetService } from "homelab/src/platform-model.ts";
import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  restrictedContainer,
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/zfs-nvme-volume.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

const MAINTAINERR_PORT = 6246;
/** The image's `node` user, which owns /opt/app. */
const MAINTAINERR_UID = 1000;

export function createMaintainerrDeployment(chart: Chart) {
  // Not a LinuxServer.io image: it declares `USER node` and never reads
  // PUID/PGID. fsGroup keeps the existing config claim writable by that group.
  const deployment = new Deployment(chart, "maintainerr", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    securityContext: { fsGroup: MAINTAINERR_UID },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "The entrypoint rewrites the UI's base path in /opt/app/ui in place",
      },
    },
  });

  const config = new ZfsNvmeVolume(chart, "maintainerr-pvc", {
    storage: Size.gibibytes(8),
  });

  deployment.addContainer(
    withCommonProps({
      image: `ghcr.io/jorenn92/maintainerr:${versions["jorenn92/maintainerr"]}`,
      portNumber: MAINTAINERR_PORT,
      securityContext: {
        ...restrictedContainer(MAINTAINERR_UID),
        readOnlyRootFilesystem: false,
      },
      volumeMounts: [
        {
          path: "/opt/data",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "maintainerr-volume",
            config.claim,
          ),
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
  setRevisionHistoryLimit(deployment);

  const service = new Service(chart, "maintainerr-service", {
    selector: deployment,
    ports: [{ port: MAINTAINERR_PORT }],
  });

  new TailscaleIngress(chart, "maintainerr-tailscale-ingress", {
    service,
    host: tailnetService("maintainerr"),
    proxyClass: "medium",
  });
}
