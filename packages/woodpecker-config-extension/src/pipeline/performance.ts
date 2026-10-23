import type { CiStep } from "./model.ts";
import type { PerformanceOptions } from "#src/performance-config.ts";
import { ramScratchProfile } from "./ram-scratch.ts";

export const WORKSPACE_SEEDS = {
  claim: "woodpecker-workspace-seeds",
  path: "/woodpecker/workspace-seeds",
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
 * Bun materializes node_modules from the shared cache claim with
 * copy_file_range. Both claims sit in liskov's ZFS pool, where block cloning
 * can share the blocks instead of writing a second copy.
 */
const COPYFILE = { CI_BUN_INSTALL_BACKEND: "copyfile" } as const;
function environment(step: CiStep, options: PerformanceOptions, main: boolean) {
  return {
    ...step.environment,
    ...(options.formatting && step.key === "verify"
      ? { CI_FORMAT_CACHE_ROOT: `${FORMAT_CACHE_PATH}/${main ? "main" : "pr"}` }
      : {}),
    ...(options.copyfile ? COPYFILE : {}),
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
  main: boolean,
  credentialless: boolean,
): CiStep[] {
  if (credentialless) return [...steps];
  return steps.map((step) => {
    if (step.backend === "local") return step;
    if (step.skipClone === true) return step;
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
      environment: environment(step, options, main),
      ...orderedFields(step, options),
      ...(options.formatting && step.key === "verify"
        ? {
            volumes: [
              ...(step.volumes ?? []),
              {
                claim: `woodpecker-format-${main ? "main" : "pr"}`,
                path: FORMAT_CACHE_PATH,
              },
            ],
          }
        : {}),
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
