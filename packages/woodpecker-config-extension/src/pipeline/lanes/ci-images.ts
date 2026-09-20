import type { CiImages } from "#src/images.ts";
import type { CiStep, SecretGrant } from "#src/pipeline/model.ts";
import { MEDIUM_TIER, VERIFY_TIER } from "#src/pipeline/tiers.ts";
import {
  GITHUB_DOWNLOAD,
  grant,
  HANDOFF_KEYS,
} from "#src/pipeline/lanes/tofu.ts";

/**
 * Toolchain image refreshes and the version pin commit-back.
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

const GHCR_PUSH = grant("ci-github-credentials", "GITHUB_PACKAGES_TOKEN");

/**
 * Rebuild one toolchain image and pin the result.
 *
 * The build and the pin are one step on purpose: an image pushed but never
 * pinned is invisible to every later build, and a pin written for an image
 * that failed to push would break every lane at once.
 */
function refreshStep(
  images: CiImages,
  name: "ci-base" | "ci-playwright",
): CiStep {
  return {
    key: `${name}-refresh`,
    label: `refresh ${name} image`,
    image: images.base,
    commands: [
      `if ! bun --no-install ci/scripts/selectors/ci-changed.ts ${name}; then exit 0; fi`,
      ". ci/scripts/toolchain.sh",
      "bun --no-install ci/scripts/reporting/buildkit-env.ts",
      `bun --no-install ci/scripts/images/build-ci-image.ts --image ${name} --candidate-out ${name}-candidate.json`,
      `bun --no-install ci/scripts/images/update-ci-image-pin.ts --candidate ${name}-candidate.json`,
    ],
    dependsOn: ["verify"],
    timeoutMinutes: 60,
    resources: VERIFY_TIER,
    defaultBranchOnly: true,
    concurrency: { limit: 1, group: `${name}-refresh` },
    secrets: [GITHUB_DOWNLOAD, GHCR_PUSH, ...GITHUB_APP],
  };
}

export function ciImageSteps(images: CiImages): CiStep[] {
  return [
    refreshStep(images, "ci-base"),
    refreshStep(images, "ci-playwright"),
    {
      key: "version-commit-back",
      label: "commit back image pins",
      image: images.base,
      commands: [
        ". ci/scripts/toolchain.sh",
        "ci/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/root-scripts' --production",
        'bun --no-install scripts/release/update-versions.ts --commit-back --candidates "$(bun --no-install scripts/ci/read-ci-handoff.ts pin-candidates)"',
      ],
      dependsOn: ["images"],
      timeoutMinutes: 60,
      resources: MEDIUM_TIER,
      defaultBranchOnly: true,
      // Shares the image lane's group: the pin it writes describes exactly
      // what that lane pushed, so the two must not interleave across builds.
      concurrency: { limit: 1, group: "image-push" },
      secrets: [GITHUB_DOWNLOAD, ...GITHUB_APP, ...HANDOFF_KEYS],
    },
  ];
}
