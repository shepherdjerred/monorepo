/**
 * Containers that are deliberately BestEffort (no CPU/memory requests).
 *
 * Key format: "<workload-name>/<container-name>". Every entry needs a rationale.
 * Enforced both ways by src/container-resources.test.ts: containers missing
 * requests must be listed here, and stale entries fail the test.
 *
 * These are non-critical, evictable-by-design workloads per the 2026-06-12
 * right-sizing audit (packages/docs/plans/2026-06-12_k8s-resource-rightsizing.md):
 * under memory pressure they are the correct first victims, ahead of
 * storage/GitOps/monitoring infra which carries explicit requests.
 */
export const BEST_EFFORT_CONTAINER_ALLOWLIST: ReadonlySet<string> = new Set([
  // One-shot init containers — run once at pod start, negligible usage.
  "bugsink/migrate",
  "bugsink/migrate-snappea",
  "mcp-gateway/render-config",
  "media-qbittorrent/qbittorrent-config-seed",
  "plausible/build-db-url",
  // Metrics/sidecar helpers — tiny, lose nothing on eviction.
  "media-plex/plex-exporter",
  "media-qbittorrent/qbittorrent-exporter",
  "media-qbittorrent/gluetun",
  // Non-critical apps, evictable by design.
  "ddns/main",
  "freshrss/main",
  "gickup/main",
  "golink/main",
  "media-plex/main",
  "media-prowlarr/main",
  "media-recyclarr/main",
  "media-tautulli/main",
  "redlib/main",
  "s3-static-sites/caddy",
  "starlight-karma-bot-beta-starlight-karma-bot-backend/main",
  "starlight-karma-bot-prod-starlight-karma-bot-backend/main",
  "syncthing/main",
]);
