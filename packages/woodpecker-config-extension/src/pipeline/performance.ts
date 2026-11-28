import type { CiStep } from "./model.ts";
import type { PerformanceOptions } from "#src/performance-config.ts";
import { ramScratchProfile } from "./ram-scratch.ts";
import { withSharedMiseInstalls } from "./cache.ts";
import type { FormatCacheScope } from "./cache-trust-domain.ts";

export const WORKSPACE_SEEDS = {
  claim: "woodpecker-workspace-seeds",
  path: "/woodpecker/workspace-seeds",
};
/** Written only by the golden maintenance publisher; see checkout/golden.ts. */
export const WORKSPACE_GOLDEN = {
  claim: "woodpecker-workspace-golden",
  path: "/woodpecker/golden",
};
export const SEED_CONTROL = {
  claim: "woodpecker-source-control",
  path: "/woodpecker/source-control",
};
const PROFILES: Readonly<Record<string, "verify" | "browser">> = {
  verify: "verify",
  "playwright-e2e": "browser",
};
const FORMAT_CACHE_PATH = "/woodpecker/format-cache";
/**
 * Meant to let liskov's ZFS pool clone node_modules blocks from the shared
 * cache claim. The pool's clone savings show it does not; golden workspace
 * clones remove the install's writes instead (checkout/golden.ts).
 */
const COPYFILE = { CI_BUN_INSTALL_BACKEND: "copyfile" } as const;
/** The formatter volume this step mounts, if any. */
function formatCache(
  step: CiStep,
  options: PerformanceOptions,
  format: FormatCacheScope,
): Exclude<FormatCacheScope, "none"> | undefined {
  if (format === "none" || !options.formatting || step.key !== "verify") return;
  return format;
}

function environment(
  step: CiStep,
  options: PerformanceOptions,
  format: FormatCacheScope,
) {
  const scope = formatCache(step, options, format);
  return {
    ...step.environment,
    ...(scope === undefined
      ? {}
      : { CI_FORMAT_CACHE_ROOT: `${FORMAT_CACHE_PATH}/${scope}` }),
    ...(options.copyfile ? COPYFILE : {}),
  };
}

function formatVolumes(
  step: CiStep,
  options: PerformanceOptions,
  format: FormatCacheScope,
) {
  const scope = formatCache(step, options, format);
  return scope === undefined
    ? {}
    : {
        volumes: [
          ...(step.volumes ?? []),
          { claim: `woodpecker-format-${scope}`, path: FORMAT_CACHE_PATH },
        ],
      };
}

/** Each scratch profile reserves its tmpfs above the lane's own tier. */
function scratchFields(step: CiStep, options: PerformanceOptions) {
  const scratch = options.scratch ? ramScratchProfile(step.key) : undefined;
  return scratch === undefined
    ? {}
    : { ramScratch: true, resources: scratch.resources };
}

/** Ordered containers run their own installs from the same checkout. */
function orderedFields(step: CiStep, options: PerformanceOptions) {
  return options.copyfile && step.orderedSteps !== undefined
    ? {
        orderedSteps: step.orderedSteps.map((command) => ({
          ...command,
          environment: { ...command.environment, ...COPYFILE },
        })),
      }
    : {};
}

export function performanceSteps(
  steps: readonly CiStep[],
  options: PerformanceOptions,
  /** See `formatCacheScope`; `none` mounts no formatter results. */
  format: FormatCacheScope,
  credentialless: boolean,
): CiStep[] {
  if (credentialless) return [...steps];
  return steps.map((original) => {
    if (original.backend === "local") return original;
    if (original.skipClone === true) return original;
    // Runtime mise installs move onto the shared claim on every container that
    // bootstraps the toolchain, ordered containers included.
    const step = options.miseInstalls
      ? withSharedMiseInstalls(original)
      : original;
    const profile = PROFILES[step.key];
    const prepared =
      options.prepared &&
      profile !== undefined &&
      step.sourceCache !== undefined;
    const gradle =
      options.gradle && step.key === "verify" && step.sourceCache !== undefined;
    return {
      ...step,
      ...scratchFields(step, options),
      environment: environment(step, options, format),
      ...orderedFields(step, options),
      ...formatVolumes(step, options, format),
      ...(step.sourceCache === undefined
        ? {}
        : {
            sourceCache: {
              ...step.sourceCache,
              incremental: options.incremental,
              ...(gradle ? { gradle: { image: step.image } } : {}),
              ...(prepared ? { prepared: { profile, image: step.image } } : {}),
            },
          }),
    };
  });
}
