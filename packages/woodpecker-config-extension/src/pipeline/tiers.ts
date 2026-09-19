import type { ResourceTier } from "#src/pipeline/model.ts";

/**
 * Resource tiers, carried over verbatim from the Buildkite pod anchors.
 *
 * These numbers are incident-derived, not estimates, so they are ported as-is
 * rather than re-derived. Changing one changes how many steps the CI node
 * admits concurrently.
 */

/**
 * Heavy steps: the full turbo graph on a cold cache.
 *
 * The large memory request covers the memory-backed workspace as well as the
 * build itself — the workspace volume's pages count against the container's
 * limit.
 */
export const VERIFY_TIER: ResourceTier = {
  cpuRequest: "1",
  cpuLimit: "12",
  memoryRequest: "18Gi",
  memoryLimit: "24Gi",
  ephemeralStorageRequest: "2Gi",
  ephemeralStorageLimit: "40Gi",
};

/**
 * Thin deploy/publish/report steps whose work is seconds even cold.
 *
 * Small requests so the scheduler places them alongside a running heavy step
 * instead of queueing them behind it; limits stay high so a cold-cache burst
 * still gets real CPU.
 */
export const LIGHT_TIER: ResourceTier = {
  cpuRequest: "250m",
  cpuLimit: "7",
  memoryRequest: "512Mi",
  memoryLimit: "12Gi",
  ephemeralStorageRequest: "1Gi",
  ephemeralStorageLimit: "20Gi",
};
