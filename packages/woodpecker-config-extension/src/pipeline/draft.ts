import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { BUN_CACHE, BUN_CACHE_CONTROL } from "#src/pipeline/cache.ts";
import { GITHUB_DOWNLOAD } from "#src/pipeline/lanes/tofu.ts";
import { LIGHT_TIER } from "#src/pipeline/tiers.ts";
import { isDraftPrEvent } from "#src/pr-event.ts";
import type { Pipeline } from "#src/schemas.ts";
import { credentiallessHostedAutomationSteps } from "#src/pipeline/steps.ts";
import { selectSteps, type SelectionContext } from "#src/pipeline/select.ts";

export function limitedPrSteps(input: {
  images: CiImages;
  pipeline: Pipeline;
  context: SelectionContext;
  credentialless: boolean;
}): CiStep[] | undefined {
  if (isDraftPrEvent(input.pipeline))
    return [draftPreflightStep(input.images, input.credentialless)];
  return input.credentialless
    ? selectSteps(
        credentiallessHostedAutomationSteps(input.images),
        input.context,
      )
    : undefined;
}

/** A draft supplies feedback only; it never emits the required merge verdict. */
export function draftPreflightStep(
  images: CiImages,
  credentialless = false,
): CiStep {
  return {
    key: "draft-preflight",
    label: "check draft formatting, lockfile, conflicts and secrets",
    image: images.base,
    commands: [
      "MISE_TOOLCHAIN_SCOPE=preflight . ci/scripts/toolchain.sh",
      "ci/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/root-scripts' --production --ignore-scripts",
      'git fetch --no-tags --depth=100 origin "$CI_COMMIT_SHA"',
      'git fetch --no-tags --depth=100 origin "$CI_COMMIT_TARGET_BRANCH"',
      'draft_base="$(git merge-base HEAD FETCH_HEAD)"',
      'bun --no-install scripts/ci/draft/preflight.ts "$draft_base"',
    ],
    timeoutMinutes: 3,
    resources: LIGHT_TIER,
    ...(credentialless
      ? {}
      : {
          secrets: [GITHUB_DOWNLOAD],
          volumes: [BUN_CACHE, BUN_CACHE_CONTROL],
        }),
  };
}
