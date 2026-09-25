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
 * The memory request was sized under Buildkite, whose workspace was a
 * memory-backed volume charged to the pod. Woodpecker's workspace is a claim
 * on the CI node's NVMe, so part of this reservation no longer covers
 * anything; it is kept until measured usage says what to lower it to.
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

/**
 * Medium steps: a single package's build and test on a cold cache.
 *
 * Between LIGHT and VERIFY — enough memory to compile one workspace without
 * reserving the whole node for it.
 */
export const MEDIUM_TIER: ResourceTier = {
  cpuRequest: "1",
  cpuLimit: "7",
  memoryRequest: "2Gi",
  memoryLimit: "12Gi",
  ephemeralStorageRequest: "2Gi",
  ephemeralStorageLimit: "40Gi",
};

/**
 * Scanner steps: third-party images that read the tree and exit.
 *
 * Deliberately small and bounded — these lanes are advisory, so they must
 * never crowd out a blocking lane on the CI node.
 */
export const SCANNER_TIER: ResourceTier = {
  cpuRequest: "250m",
  cpuLimit: "2",
  memoryRequest: "512Mi",
  memoryLimit: "4Gi",
  ephemeralStorageRequest: "1Gi",
  ephemeralStorageLimit: "10Gi",
};

/**
 * Bounded steps: a single tool doing one job in a third-party image.
 *
 * Tighter limits than MEDIUM because these lanes have a known, small working
 * set and no turbo graph behind them.
 */
export const CONTAINED_TIER: ResourceTier = {
  cpuRequest: "1",
  cpuLimit: "2",
  memoryRequest: "2Gi",
  memoryLimit: "4Gi",
  ephemeralStorageRequest: "2Gi",
  ephemeralStorageLimit: "8Gi",
};

/**
 * Browser steps: headless Chromium plus the app under test.
 *
 * The large memory REQUEST is the point -- browsers are not bursty, they hold
 * their working set, so a small request would let the scheduler overcommit the
 * node and get the lane OOM-killed mid-suite.
 */
export const BROWSER_TIER: ResourceTier = {
  cpuRequest: "1",
  cpuLimit: "8",
  memoryRequest: "9Gi",
  memoryLimit: "12Gi",
  ephemeralStorageRequest: "2Gi",
  ephemeralStorageLimit: "20Gi",
};

/**
 * A step's services -- the databases and daemons it talks to by hostname.
 *
 * Each is its own pod, admitted by Kueue before its step, so its request is
 * reserved for as long as the step waits for quota. Kept small for that
 * reason: `check-ci-admission-budget.ts` proves that every in-flight
 * workflow's admitted services together can never starve a step.
 */
export const SERVICE_TIER: ResourceTier = {
  cpuRequest: "250m",
  cpuLimit: "2",
  memoryRequest: "512Mi",
  memoryLimit: "2Gi",
  ephemeralStorageRequest: "1Gi",
  ephemeralStorageLimit: "5Gi",
};

/**
 * .NET cross-builds in the Windows cross-compiler images: restore and MSBuild
 * run several projects in parallel. Requests and limits carried over from the
 * Buildkite lane; the build writes to the workspace claim, not ephemeral
 * storage.
 */
export const CROSS_BUILD_TIER: ResourceTier = {
  cpuRequest: "4",
  cpuLimit: "8",
  memoryRequest: "8Gi",
  memoryLimit: "16Gi",
  ephemeralStorageRequest: "2Gi",
  ephemeralStorageLimit: "40Gi",
};
