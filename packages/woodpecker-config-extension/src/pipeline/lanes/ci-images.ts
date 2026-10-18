import type { CiImages } from "#src/images.ts";
import {
  DOCKERHUB_PUBLISH,
  DOCKERHUB_PUBLISH_LOGIN,
} from "#src/pipeline/lanes/registry.ts";
import type { CiStep, SecretGrant } from "#src/pipeline/model.ts";
import { IMAGE_ORCHESTRATION_TIER } from "#src/pipeline/tiers.ts";
import { GITHUB_DOWNLOAD, grant } from "#src/pipeline/lanes/tofu.ts";

/**
 * Toolchain image refreshes.
 *
 * These lanes write back to the repository, so they hold the GitHub App
 * credential rather than only the read token. The App identity is what lets a
 * commit from CI pass branch protection without a personal token.
 */

/** Mint-and-push identity for commits made by CI. */
const GITHUB_APP: readonly SecretGrant[] = [
  grant("ci-github-credentials", "GITHUB_APP_ID"),
  grant("ci-github-credentials", "GITHUB_APP_INSTALLATION_ID"),
  grant("ci-github-credentials", "GITHUB_APP_PRIVATE_KEY"),
];

/**
 * Rebuild a family of toolchain images and pin each result.
 *
 * The build and the pin are one step on purpose: an image pushed but never
 * pinned is invisible to every later build, and a pin written for an image
 * that failed to push would break every lane at once.
 *
 * `lane` names the changed-path selector that decides whether anything needs
 * rebuilding; `names` are the images built from it, in order.
 */
function refreshStep(
  images: CiImages,
  lane: string,
  names: readonly string[],
  timeoutMinutes: number,
): CiStep {
  return {
    key: `${lane}-refresh`,
    label: `refresh ${lane} image${names.length > 1 ? "s" : ""}`,
    image: images.base,
    commands: [
      `if ! bun --no-install ci/scripts/selectors/ci-changed.ts ${lane}; then exit 0; fi`,
      "MISE_TOOLCHAIN_SCOPE=automation . ci/scripts/toolchain.sh",
      DOCKERHUB_PUBLISH_LOGIN,
      ...names.flatMap((name) => [
        `bun --no-install ci/scripts/images/build-ci-image.ts --image ${name} --candidate-out ${name}-candidate.json`,
        `bun --no-install ci/scripts/images/update-ci-image-pin.ts --candidate ${name}-candidate.json`,
      ]),
    ],
    dependsOn: ["verify"],
    timeoutMinutes,
    resources: IMAGE_ORCHESTRATION_TIER,
    defaultBranchOnly: true,
    concurrency: { limit: 1, group: `${lane}-refresh` },
    secrets: [GITHUB_DOWNLOAD, ...DOCKERHUB_PUBLISH, ...GITHUB_APP],
  };
}

export function ciImageSteps(images: CiImages): CiStep[] {
  return [
    refreshStep(images, "ci-base", ["ci-base"], 60),
    refreshStep(images, "ci-playwright", ["ci-playwright"], 60),
  ];
}
