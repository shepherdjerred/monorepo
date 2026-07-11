/**
 * Build-age job prioritization (FIFO-by-build).
 *
 * The Buildkite agent-stack-k8s `max-in-flight` cap is cluster-wide, shared across
 * every concurrently-running branch build. Without this, ~6 branch builds — each
 * with hundreds of jobs in dependency waves — round-robin the shared slots, so all
 * builds crawl and none finishes quickly.
 *
 * Buildkite dispatches higher-priority jobs first. By subtracting
 * `BUILDKITE_BUILD_NUMBER * BUILD_AGE_SCALE` from every command step's priority, an
 * older build (smaller build number) outranks a newer one across the whole queue, so
 * the controller concentrates its slots on the oldest build until that build has fewer
 * than `max-in-flight` runnable jobs, then spills into the next (no idle slots wasted).
 * Net effect: builds finish in FIFO order instead of all progressing a little.
 */
import type { BuildkitePipeline } from "./types.ts";

/**
 * Separates cross-build ordering from intra-build ordering. Each step's priority
 * becomes `(priority ?? 0) - buildNumber * BUILD_AGE_SCALE`, so the existing per-step
 * priorities (currently 0 for normal steps, 1 for deploy/publish steps that should run
 * first within a build) survive as the low-order tiebreak while the build-age term
 * dominates. Any intra-build priority MUST stay strictly below this value.
 */
export const BUILD_AGE_SCALE = 100;

/** Current Buildkite build number, or null when generating outside Buildkite (local runs). */
function currentBuildNumber(): number | null {
  const raw = Bun.env["BUILDKITE_BUILD_NUMBER"] ?? "";
  if (raw === "") return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Lower every command step's priority by the build's age so older builds drain before
 * newer ones. No-op when `BUILDKITE_BUILD_NUMBER` is unset (local generation). Mutates
 * `pipeline` in place and returns it. Wait steps carry no priority and are left alone.
 */
export function applyBuildAgePriority(
  pipeline: BuildkitePipeline,
  buildNumber: number | null = currentBuildNumber(),
): BuildkitePipeline {
  if (buildNumber === null) {
    return pipeline;
  }
  const offset = buildNumber * BUILD_AGE_SCALE;
  for (const step of pipeline.steps) {
    if ("command" in step) {
      step.priority = (step.priority ?? 0) - offset;
    } else if ("group" in step) {
      for (const child of step.steps) {
        child.priority = (child.priority ?? 0) - offset;
      }
    }
  }
  return pipeline;
}
