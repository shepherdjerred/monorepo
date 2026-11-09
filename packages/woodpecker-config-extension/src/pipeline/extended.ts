import { z } from "zod";
import type { Pipeline } from "#src/schemas.ts";
import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import {
  BUN_CACHE,
  BUN_CACHE_CONTROL,
  UV_CACHE,
  withSharedBunCache,
  withSharedToolCaches,
} from "#src/pipeline/cache.ts";
import { noWorkStep } from "#src/pipeline/completion.ts";
import { diagnosticCommands } from "#src/pipeline/diagnostics.ts";
import {
  GRADLE_BUILD_CACHE_ENVIRONMENT,
  grantGradleBuildCache,
} from "#src/pipeline/gradle-build-cache.ts";
import { GITHUB_DOWNLOAD, HANDOFF_KEYS } from "#src/pipeline/lanes/tofu.ts";
import { requestedSourcePipeline } from "#src/pipeline/maintenance.ts";
import { TURBO_VERIFY_TIER } from "#src/pipeline/tiers.ts";
import {
  TURBO_CACHE_TOKEN,
  TURBO_REMOTE_CACHE_ENVIRONMENT,
  signRemoteCacheSteps,
} from "#src/pipeline/turbo-cache.ts";

/**
 * The extended test tier: suites that start PostgreSQL, the Temporal test
 * server, ffmpeg or a game server, or exceed a three-minute p50. They left
 * pull-request verification as a policy; a Temporal schedule runs them once a
 * night on the newest verified main commit through this manual lane, and the
 * workflow that dispatched the request reads the result.
 */

/** Dispatcher-chosen identity of one request; echoed into the step's environment. */
export const EXTENDED_REQUEST_VARIABLE = "CI_EXTENDED_REQUEST";
/** The verified main commit the dispatcher selected; see `requestedSourcePipeline`. */
export const EXTENDED_SOURCE_VARIABLE = "CI_EXTENDED_SOURCE";
export const EXTENDED_STEP_KEY = "verify-extended";
export const EXTENDED_SUPERSEDED_KEY = "extended-superseded";

const Request = z.object({
  request: z.uuid(),
  source: z.string().regex(/^[a-f\d]{40}$/u),
});
export type ExtendedRequest = z.infer<typeof Request>;

export function isExtendedRequest(pipeline: Pipeline): boolean {
  return pipeline.variables[EXTENDED_REQUEST_VARIABLE] !== undefined;
}

/**
 * Exclusive signed owner manual request on the default branch. Like the
 * benchmark and maintenance routes it never falls through to release work,
 * and it refuses to share a pipeline with any of them.
 */
export function extendedRequest(
  pipeline: Pipeline,
  defaultBranch: string,
  owner: boolean,
): ExtendedRequest | undefined {
  if (!isExtendedRequest(pipeline)) return;
  if (
    !owner ||
    pipeline.event !== "manual" ||
    pipeline.branch !== defaultBranch ||
    pipeline.ref !== `refs/heads/${defaultBranch}` ||
    Object.keys(pipeline.variables).some(
      (key) =>
        key.startsWith("TOFU_PLATFORM_") ||
        key.startsWith("CI_MAINTENANCE_") ||
        key.startsWith("CI_BENCHMARK_") ||
        key.includes("CORPUS"),
    )
  )
    throw new Error(
      "Extended verification requires an exclusive owner manual request on the default branch",
    );
  return Request.parse({
    request: pipeline.variables[EXTENDED_REQUEST_VARIABLE],
    source: pipeline.variables[EXTENDED_SOURCE_VARIABLE],
  });
}

/** Run against the requested verified commit while it is still the verified one. */
export function extendedSourcePipeline(
  pipeline: Pipeline,
  verifiedMain: string | undefined,
): Pipeline {
  return requestedSourcePipeline(
    pipeline,
    EXTENDED_SOURCE_VARIABLE,
    verifiedMain,
  );
}

/**
 * A request whose source is no longer the verified main commit, or could not
 * be checked out in place of the tip, runs nothing: the dispatcher selects the
 * newly verified source on its next run rather than testing a moved target.
 */
export function extendedSupersededStep(image: string): CiStep {
  return {
    ...noWorkStep(image),
    key: EXTENDED_SUPERSEDED_KEY,
    label: "extended verification source superseded",
  };
}

/**
 * One workflow running `verify:extended` -- `turbo run test:extended` across
 * every workspace -- in verify's trust domain: trusted Turbo results and the
 * Gradle write identity, because it runs the default branch's own code.
 * Diagnostics publish to the build-scoped handoff bucket exactly as verify's
 * do, so per-suite timings are retained for the nightly as well. It holds no
 * release or publication identity. The group serializes nightly runs; the
 * caller routes it at the lowest admission priority so it never delays a main
 * push or a ready pull request.
 */
export function extendedSteps(
  images: CiImages,
  request: ExtendedRequest,
): CiStep[] {
  const step: CiStep = {
    key: EXTENDED_STEP_KEY,
    label: "verify (extended tier)",
    image: images.base,
    commands: diagnosticCommands(EXTENDED_STEP_KEY, [
      ". ci/scripts/toolchain.sh",
      "ci/scripts/bun-install.sh --frozen-lockfile",
      // One Turbo run in a fresh workspace: `^build` and `generate` load from
      // the trusted remote cache, while `test:extended` itself is uncached.
      'export TURBO_CACHE="remote:rw"',
      "bun --no-install run verify:extended -- --output-logs=errors-only --summarize",
    ]),
    environment: {
      ...TURBO_REMOTE_CACHE_ENVIRONMENT,
      ...GRADLE_BUILD_CACHE_ENVIRONMENT,
      // The tier runs every extended suite; there is no changed base to narrow it.
      CI_CHANGED_BASE: "",
      [EXTENDED_REQUEST_VARIABLE]: request.request,
      [EXTENDED_SOURCE_VARIABLE]: request.source,
    },
    dependsOn: [],
    timeoutMinutes: 90,
    resources: TURBO_VERIFY_TIER,
    secrets: [GITHUB_DOWNLOAD, TURBO_CACHE_TOKEN, ...HANDOFF_KEYS],
    volumes: [BUN_CACHE, BUN_CACHE_CONTROL, UV_CACHE],
    concurrency: { limit: 1, group: EXTENDED_STEP_KEY },
  };
  return grantGradleBuildCache(
    signRemoteCacheSteps(
      [withSharedToolCaches(withSharedBunCache(step))],
      "trusted",
    ),
    "trusted",
  );
}
