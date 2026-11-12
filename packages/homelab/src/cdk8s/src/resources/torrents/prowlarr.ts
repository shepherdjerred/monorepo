import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { LinuxServerApp } from "@shepherdjerred/homelab/cdk8s/src/misc/third-party/linuxserver-app.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export function createProwlarrDeployment(chart: Chart) {
  new LinuxServerApp(chart, "prowlarr-app", {
    name: "prowlarr",
    image: `ghcr.io/linuxserver/prowlarr:${versions["linuxserver/prowlarr"]}`,
    port: 9696,
    fsGroup: false,
    claims: [
      {
        claim: "prowlarr-pvc",
        volumeId: "prowlarr-volume",
        storage: Size.gibibytes(8),
        path: "/config",
      },
    ],
    // Deliberately BestEffort (no requests/limits) — negligible or
    // non-critical usage; see the 2026-06-12 right-sizing plan.
    resources: {},
    tailscale: { host: "prowlarr" },
  });
}
