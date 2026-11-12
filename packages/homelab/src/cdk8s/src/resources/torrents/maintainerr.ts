import { Cpu } from "cdk8s-plus-31";
import { tailnetService } from "homelab/src/platform-model.ts";
import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { LinuxServerApp } from "@shepherdjerred/homelab/cdk8s/src/misc/third-party/linuxserver-app.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export function createMaintainerrDeployment(chart: Chart) {
  // Not a LinuxServer.io image, but it has always been rendered with their
  // root-start security context, PUID/PGID and kube-linter exemptions.
  new LinuxServerApp(chart, "maintainerr-app", {
    name: "maintainerr",
    image: `ghcr.io/jorenn92/maintainerr:${versions["jorenn92/maintainerr"]}`,
    port: 6246,
    fsGroup: true,
    claims: [
      {
        claim: "maintainerr-pvc",
        volumeId: "maintainerr-volume",
        storage: Size.gibibytes(8),
        path: "/opt/data",
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
    tailscale: { host: tailnetService("maintainerr"), proxyClass: "medium" },
  });
}
