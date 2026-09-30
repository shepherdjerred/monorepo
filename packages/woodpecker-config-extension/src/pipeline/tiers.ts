import type { ResourceTier } from "#src/pipeline/model.ts";

/**
 * Resource requests govern Kueue admission on the CI node. Limits still bound
 * each container after admission.
 */

/**
 * Heavy steps: the full turbo graph on a cold cache.
 *
 * The workspace moved from a Buildkite memory volume to the CI node's NVMe,
 * but Woodpecker verify pods have still reached over 13 GiB of memory. Keep
 * memory headroom for heavy builds and releases.
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
 * The full Turbo verify graph has reached over 9 CPU cores. Reserve most of
 * that demand so Kueue cannot admit too many verify pods at once; other heavy
 * release steps retain the shared tier's smaller CPU request.
 */
export const TURBO_VERIFY_TIER: ResourceTier = {
  ...VERIFY_TIER,
  cpuRequest: "8",
};

/**
 * PR release rehearsals run sequential commands, not the full Turbo graph.
 * Their measured working set stayed below 1 GiB over four days, so 4 GiB
 * reserves cold-run headroom without occupying a verify pod's 18 GiB slot.
 * Keep the heavy tier's limits for an unexpectedly expensive rehearsal.
 */
export const PR_DRY_RUN_TIER: ResourceTier = {
  ...VERIFY_TIER,
  cpuRequest: "1",
  memoryRequest: "4Gi",
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
 * Four days of Woodpecker runs peaked below 4 CPU cores and 3 GiB of memory.
 * Reserve room above those peaks while retaining the existing hard limits.
 */
export const BROWSER_TIER: ResourceTier = {
  cpuRequest: "3",
  cpuLimit: "8",
  memoryRequest: "6Gi",
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
