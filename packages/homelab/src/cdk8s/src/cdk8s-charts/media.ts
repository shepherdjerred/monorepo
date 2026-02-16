import { App, Chart, Size } from "cdk8s";
import { ZfsSataVolume } from "../misc/zfs-sata-volume.ts";
import { createBazarrDeployment } from "../resources/torrents/bazarr.ts";
import { createTautulliDeployment } from "../resources/media/tautulli.ts";
import { createPlexDeployment } from "../resources/media/plex.ts";
import { createRadarrDeployment } from "../resources/torrents/radarr.ts";
import { createOverseerrDeployment } from "../resources/torrents/overseerr.ts";
import { createQBitTorrentDeployment } from "../resources/torrents/qbittorrent.ts";
import { createSonarrDeployment } from "../resources/torrents/sonarr.ts";
import { createProwlarrDeployment } from "../resources/torrents/prowlarr.ts";
import { createMaintainerrDeployment } from "../resources/torrents/maintainerr.ts";
import { createRecyclarrDeployment } from "../resources/torrents/recyclarr.ts";
import { createWhisperbridgeDeployment } from "../resources/torrents/whisperbridge.ts";
import { KubeNetworkPolicy } from "../../generated/imports/k8s.ts";

export function createMediaChart(app: App) {
  const chart = new Chart(app, "media", {
    namespace: "media",
    disableResourceNameHashes: true,
  });

  // Shared volumes for media stack
  const tvVolume = new ZfsSataVolume(chart, "plex-tv-hdd-pvc", {
    storage: Size.tebibytes(4),
  });
  const downloadsVolume = new ZfsSataVolume(chart, "qbittorrent-hdd-pvc", {
    storage: Size.tebibytes(1),
  });
  const moviesVolume = new ZfsSataVolume(chart, "plex-movies-hdd-pvc", {
    storage: Size.tebibytes(4),
  });

  // Media services that share volumes
  createBazarrDeployment(chart, {
    tv: tvVolume.claim,
    movies: moviesVolume.claim,
  });
  createTautulliDeployment(chart);
  createPlexDeployment(chart, {
    tv: tvVolume.claim,
    movies: moviesVolume.claim,
  });
  createRadarrDeployment(chart, {
    movies: moviesVolume.claim,
    downloads: downloadsVolume.claim,
  });
  createOverseerrDeployment(chart);
  createQBitTorrentDeployment(chart, {
    downloads: downloadsVolume.claim,
  });
  createSonarrDeployment(chart, {
    tv: tvVolume.claim,
    downloads: downloadsVolume.claim,
  });
  createProwlarrDeployment(chart);
  createMaintainerrDeployment(chart);
  createRecyclarrDeployment(chart);
  createWhisperbridgeDeployment(chart);

  // NetworkPolicy: Default deny ingress from outside namespace
  // Allows Tailscale, Cloudflare tunnel, intra-namespace, and Prometheus
  new KubeNetworkPolicy(chart, "media-ingress-policy", {
    metadata: { name: "media-ingress-policy" },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress"],
      ingress: [
        // Allow from Tailscale (private access)
        {
          from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "tailscale" } } }],
        },
        // Allow from Cloudflare tunnel (public access for plex, overseerr)
        {
          from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "cloudflare-tunnel" } } }],
        },
        // Allow all intra-namespace communication
        // Media services are highly interconnected: sonarr<->radarr<->prowlarr<->qbittorrent<->bazarr<->plex<->overseerr<->maintainerr
        {
          from: [{ podSelector: {} }],
        },
        // Allow Prometheus scraping from monitoring namespace
        {
          from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "prometheus" } } }],
        },
      ],
    },
  });
}
