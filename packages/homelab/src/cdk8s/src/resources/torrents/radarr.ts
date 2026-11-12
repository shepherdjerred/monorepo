import { Cpu, type PersistentVolumeClaim } from "cdk8s-plus-31";
import { tailnetService } from "homelab/src/platform-model.ts";
import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { LinuxServerApp } from "@shepherdjerred/homelab/cdk8s/src/misc/third-party/linuxserver-app.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export function createRadarrDeployment(
  chart: Chart,
  claims: {
    movies: PersistentVolumeClaim;
    downloads: PersistentVolumeClaim;
  },
) {
  new LinuxServerApp(chart, "radarr-app", {
    name: "radarr",
    image: `ghcr.io/linuxserver/radarr:${versions["linuxserver/radarr"]}`,
    port: 7878,
    fsGroup: true,
    claims: [
      {
        claim: "radarr-pvc",
        volumeId: "radarr-volume",
        storage: Size.gibibytes(8),
        path: "/config",
      },
    ],
    sharedMounts: [
      {
        volumeId: "radarr-torrents-hdd-volume",
        claim: claims.downloads,
        path: "/downloads",
      },
      {
        volumeId: "radarr-movies-hdd-volume",
        claim: claims.movies,
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
    tailscale: { host: tailnetService("radarr") },
  });
}
