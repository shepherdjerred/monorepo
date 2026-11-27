import type { ResourceTier } from "#src/pipeline/model.ts";

/**
 * Resource requests govern Kueue admission on the CI node. Limits still bound
 * each container after admission.
 *
 * Requests are sized from measured usage, a deliberate slight overcommit:
 * memory at the lane's p90 per-pod peak working set (tmpfs pages included),
 * CPU at the p50 lifetime average for CPU-heavy lanes and the p90 peak for
 * light ones (CPU is compressible). Limits are unchanged; they stay the OOM
 * backstop above the request. Each tier records its measurement: 14 days of
 * Woodpecker pods in `woodpecker-ci`, grouped by `ci.sjer.red/step-key`,
 * measured 2026-11-26. Over that window liskov had no OOM kills, no kubelet
 * evictions, and at least 48.8 GiB of memory available.
 */

/**
 * Heavy steps that are not the Turbo graph: site builds, the Scout site
 * archive, and publish.
 *
 * Measured 2026-11-26 (740 pods): memory p90 2.6 GiB, max 3.3 GiB; CPU p90
 * peak 0.9 cores. The limits keep headroom for a cold heavy build, and the
 * other heavy tiers below inherit them.
 */
export const VERIFY_TIER: ResourceTier = {
  cpuRequest: "1",
  cpuLimit: "12",
  memoryRequest: "3Gi",
  memoryLimit: "24Gi",
  ephemeralStorageRequest: "2Gi",
  ephemeralStorageLimit: "40Gi",
};

/**
 * The full Turbo verify graph.
 *
 * Measured 2026-11-26 (1,651 RAM-scratch pods, tmpfs included): memory p50
 * 10.9 GiB, p90 19.7 GiB, p99 31.6 GiB, max 35.9 GiB; lifetime-average CPU p50
 * 5.6 cores, peak p90 11.6 cores; duration p50 4 min, p90 8.5 min. Half of
 * each pod's life sits below about 6 GiB, so peaks rarely coincide.
 *
 * Memory is requested at the measured p90, but CPU stays at 8 cores, above
 * the 5.6-core lifetime average: liskov saturates on CPU before memory. While
 * a temporary policy halved CPU requests of 4 or more, liskov CPU went from
 * 22-38% busy to 79-93% busy and CPU pressure ("some") from about 5% to
 * 43-49%, and unrelated PRs timed out on tight-deadline steps. Requests at the
 * average leave no headroom for bursts, so overlapping verify pods saturate
 * the node.
 */
export const TURBO_VERIFY_TIER: ResourceTier = {
  ...VERIFY_TIER,
  cpuRequest: "8",
  memoryRequest: "20Gi",
};

/**
 * PR release rehearsals run sequential commands, not the full Turbo graph.
 *
 * Measured 2026-11-26 (785 pods): memory p90 0.54 GiB, max 0.8 GiB; CPU p90
 * peak 0.55 cores. Keep the heavy tier's limits for an unexpectedly expensive
 * rehearsal.
 */
export const PR_DRY_RUN_TIER: ResourceTier = {
  ...VERIFY_TIER,
  cpuRequest: "500m",
  memoryRequest: "1Gi",
};

/**
 * Image orchestration runs the build on the separate BuildKit service. The
 * Woodpecker container only prepares inputs, starts the build, and records
 * pins.
 *
 * Measured 2026-11-26 (458 pods): memory p90 0.19 GiB, max 1.1 GiB; CPU p90
 * peak 0.4 cores. The build's own memory is buildkitd's, outside Kueue. The
 * heavy tier's hard limits are retained.
 */
export const IMAGE_ORCHESTRATION_TIER: ResourceTier = {
  ...VERIFY_TIER,
  cpuRequest: "500m",
  memoryRequest: "512Mi",
};

/**
 * Thin deploy/publish/report steps whose work is seconds even cold.
 *
 * Measured 2026-11-26 (652 pods): memory p90 0.1 GiB; CPU p90 peak 0.25
 * cores. Limits stay high so a cold-cache burst still gets real CPU.
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
 * The Git checkout container that runs before every step.
 *
 * Measured 2026-11-26 (8,993 pods): memory p90 1.6 GiB, max 2.5 GiB, mostly
 * Git's packfile and worktree pages; median duration 15 seconds. The
 * preparation containers around it stay on `LIGHT_TIER`.
 */
export const CHECKOUT_TIER: ResourceTier = {
  ...LIGHT_TIER,
  memoryRequest: "2Gi",
};

/**
 * Four trusted, checkout-free gate slots fit in the dedicated Kueue reserve.
 *
 * Measured 2026-11-26 (1,165 pods): memory max 0.02 GiB. Left as is: the
 * gate reserve is sized to these requests and holds no compute work.
 */
export const GATE_TIER: ResourceTier = {
  cpuRequest: "250m",
  cpuLimit: "1",
  memoryRequest: "512Mi",
  memoryLimit: "1Gi",
  ephemeralStorageRequest: "1Gi",
  ephemeralStorageLimit: "2Gi",
};

/**
 * Medium steps: a single package's build and test on a cold cache.
 *
 * Measured 2026-11-26 (1,207 pods outside the storm smoke test, which has its
 * own tier): tofu-validate is the largest, with memory p90 1.9 GiB and max 2.3
 * GiB; every other lane stays below 1.5 GiB. CPU p90 peak is below 1.5 cores.
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
 * Measured 2026-11-26 (1,234 pods): semgrep memory p90 1.2 GiB, max 1.8 GiB;
 * trivy max 0.4 GiB; CPU p90 peak 0.3 cores. These lanes are advisory, so
 * the limits stay tight.
 */
export const SCANNER_TIER: ResourceTier = {
  cpuRequest: "250m",
  cpuLimit: "2",
  memoryRequest: "1536Mi",
  memoryLimit: "4Gi",
  ephemeralStorageRequest: "1Gi",
  ephemeralStorageLimit: "10Gi",
};

/**
 * Bounded steps: a single tool doing one job in a third-party image.
 *
 * Measured 2026-11-26 (637 pods): memory p90 0.75 GiB, max 1.1 GiB; CPU p90
 * peak 0.35 cores. Tighter limits than MEDIUM because these lanes have a
 * known, small working set and no turbo graph behind them.
 */
export const CONTAINED_TIER: ResourceTier = {
  cpuRequest: "500m",
  cpuLimit: "2",
  memoryRequest: "1Gi",
  memoryLimit: "4Gi",
  ephemeralStorageRequest: "2Gi",
  ephemeralStorageLimit: "8Gi",
};

/**
 * Browser steps: headless Chromium plus the app under test.
 *
 * Measured 2026-11-26 (1,357 RAM-scratch pods, tmpfs included): memory p90
 * 3.2 GiB, max 4.4 GiB; lifetime-average CPU p50 2.0 cores, peak p90 5.0
 * cores. The existing hard limits are retained.
 *
 * Memory is requested at the measured p90, but CPU stays at 3 cores, above
 * the 2.0-core lifetime average, for the same reason as `TURBO_VERIFY_TIER`:
 * liskov saturates on CPU first (79-93% busy with halved requests, against
 * 22-38% before), and playwright-e2e timed out at 30 minutes.
 */
export const BROWSER_TIER: ResourceTier = {
  cpuRequest: "3",
  cpuLimit: "8",
  memoryRequest: "4Gi",
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
 *
 * Measured 2026-11-26 (1,420 pods: tempo, minio, the storm brain): memory p90
 * 0.22 GiB, max 0.28 GiB; CPU p90 peak 0.01 cores.
 */
export const SERVICE_TIER: ResourceTier = {
  cpuRequest: "100m",
  cpuLimit: "2",
  memoryRequest: "256Mi",
  memoryLimit: "2Gi",
  ephemeralStorageRequest: "1Gi",
  ephemeralStorageLimit: "5Gi",
};
