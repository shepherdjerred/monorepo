import type { CiStep } from "./model.ts";

export const SOURCE_CACHE_MAIN = "woodpecker-source-main";
export const SOURCE_CACHE_PR = "woodpecker-source-pr";
export const SOURCE_CACHE_CONTROL = "woodpecker-source-control";
export const SOURCE_CACHE_PATH = "/woodpecker/source-cache";
export const SOURCE_CACHE_CONTROL_PATH = "/woodpecker/source-control";

export function cacheSourceSteps(
  steps: readonly CiStep[],
  input: {
    enabled: boolean;
    credentialless: boolean;
    main: boolean;
    image?: string | undefined;
  },
): CiStep[] {
  if (!input.enabled || input.credentialless || input.image === undefined)
    return [...steps];
  const image = input.image;
  return steps.map((step) =>
    step.skipClone === true || step.backend === "local"
      ? step
      : {
          ...step,
          sourceCache: {
            image,
            claim: input.main ? SOURCE_CACHE_MAIN : SOURCE_CACHE_PR,
          },
        },
  );
}
