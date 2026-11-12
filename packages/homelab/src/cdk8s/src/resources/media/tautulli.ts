import type { Chart } from "cdk8s";
import { tailnetService } from "homelab/src/platform-model.ts";
import { Size } from "cdk8s";
import { LinuxServerApp } from "@shepherdjerred/homelab/cdk8s/src/misc/third-party/linuxserver-app.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export function createTautulliDeployment(chart: Chart) {
  new LinuxServerApp(chart, "tautulli-app", {
    name: "tautulli",
    image: `ghcr.io/linuxserver/tautulli:${versions["linuxserver/tautulli"]}`,
    port: 8181,
    fsGroup: false,
    claims: [
      {
        claim: "tautulli-pvc",
        volumeId: "tautulli-volume",
        storage: Size.gibibytes(8),
        path: "/config",
      },
    ],
    // Deliberately BestEffort (no requests/limits) — negligible or
    // non-critical usage; see the 2026-06-12 right-sizing plan.
    resources: {},
    tailscale: { host: tailnetService("tautulli") },
  });
}
