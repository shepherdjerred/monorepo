import { Cpu, type PersistentVolumeClaim } from "cdk8s-plus-31";
import { tailnetService } from "homelab/src/platform-model.ts";
import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { LinuxServerApp } from "@shepherdjerred/homelab/cdk8s/src/misc/third-party/linuxserver-app.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export function createSonarrDeployment(
  chart: Chart,
  claims: {
    tv: PersistentVolumeClaim;
    downloads: PersistentVolumeClaim;
  },
) {
  new LinuxServerApp(chart, "sonarr-app", {
    name: "sonarr",
    image: `ghcr.io/linuxserver/sonarr:${versions["linuxserver/sonarr"]}`,
    port: 8989,
    fsGroup: true,
    claims: [
      {
        claim: "sonarr-pvc",
        volumeId: "sonarr-volume",
        storage: Size.gibibytes(8),
        path: "/config",
      },
    ],
    sharedMounts: [
      {
        volumeId: "sonarr-torrents-hdd-volume",
        claim: claims.downloads,
        path: "/downloads",
      },
      { volumeId: "sonarr-tv-hdd-volume", claim: claims.tv, path: "/tv" },
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
    tailscale: { host: tailnetService("sonarr"), proxyClass: "medium" },
  });
}
