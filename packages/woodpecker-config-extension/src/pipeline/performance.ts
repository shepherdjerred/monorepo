import type { CiStep } from "./model.ts";
import type { PerformanceOptions } from "#src/performance-config.ts";

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
function environment(step: CiStep, options: PerformanceOptions, main: boolean) {
  return {
    ...step.environment,
    ...(options.formatting && step.key === "verify"
      ? { CI_FORMAT_CACHE_ROOT: `${FORMAT_CACHE_PATH}/${main ? "main" : "pr"}` }
      : {}),
    ...(options.copyfile ? { CI_BUN_INSTALL_BACKEND: "copyfile" } : {}),
  };
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
      environment: environment(step, options, main),
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
