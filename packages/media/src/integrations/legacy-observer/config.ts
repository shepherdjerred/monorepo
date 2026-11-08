import { defineConfig } from "@shepherdjerred/config";
import { z } from "zod";

// Deployment topology is repository-owned. Callers cannot omit retirement targets.
export const LEGACY_DEPLOYMENTS = [
  "media-bazarr",
  "media-maintainerr",
  "media-prowlarr",
  "media-radarr",
  "media-recyclarr",
  "media-seerr",
  "media-sonarr",
  "media-tautulli",
  "media-whisperbridge",
];
export const RETAINED_DEPLOYMENTS = [
  "media-plex",
  "media-qbittorrent",
  "media-media-api",
  "media-media-network",
  "media-media-files",
];
export const LEGACY_OBSERVER_CONFIG = {
  schemaVersion: 1,
  namespace: "media",
  legacyDeployments: LEGACY_DEPLOYMENTS,
  retainedDeployments: RETAINED_DEPLOYMENTS,
  readOnlyDeployments: ["media-streambot"],
  retainedStatefulSets: ["media-postgresql"],
  maxPages: 5,
  pageSize: 500,
  maxObjects: 2000,
  maxBytes: 16 * 1024 * 1024,
  maxDurationMs: 30_000,
  evidenceLifetimeMs: 90_000,
};
export const legacyObserverConfig = defineConfig({
  sources: {},
  definition: {
    topology: {
      schema: z.object({
        namespace: z.literal("media"),
        schemaVersion: z.literal(1),
        legacyDeployments: z.array(z.string()).min(1).max(32),
        retainedDeployments: z.array(z.string()).max(32),
        readOnlyDeployments: z.array(z.string()).max(32),
        retainedStatefulSets: z.array(z.string()).max(32),
        maxPages: z.int().positive(),
        pageSize: z.int().positive(),
        maxObjects: z.int().positive(),
        maxBytes: z.int().positive(),
        maxDurationMs: z.int().positive(),
        evidenceLifetimeMs: z.int().positive(),
      }),
      sources: ["default"],
      default: LEGACY_OBSERVER_CONFIG,
    },
  },
});
