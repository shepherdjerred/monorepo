import type { CiImages } from "#src/images.ts";
import { admissionGate } from "#src/pipeline/lanes/release.ts";
import type { CiStep, SecretGrant } from "#src/pipeline/model.ts";
import { IMAGE_ORCHESTRATION_TIER, MEDIUM_TIER } from "#src/pipeline/tiers.ts";
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
      "bun --no-install ci/scripts/reporting/buildkit-env.ts",
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
    secrets: [GITHUB_DOWNLOAD, GHCR_PUSH, ...GITHUB_APP],
  };
}

export function ciImageSteps(images: CiImages): CiStep[] {
  return [
    refreshStep(images, "ci-base", ["ci-base"], 60),
    refreshStep(images, "ci-playwright", ["ci-playwright"], 60),
    {
      key: "version-commit-back",
      label: "commit back image pins",
      image: images.base,
      commands: [
        ...admissionGate(
          "ci/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/root-scripts' --production",
        ),
        "MISE_TOOLCHAIN_SCOPE=automation . ci/scripts/toolchain.sh",
        'bun --no-install scripts/release/update-versions.ts --commit-back --candidates "$(bun --no-install scripts/ci/read-ci-handoff.ts pin-candidates)"',
      ],
      // A pin commit creates a new main pipeline. Wait until this build's
      // exact-revision release has finished so that commit cannot supersede
      // release-root halfway through its staged child syncs.
      dependsOn: ["images", "argocd-sync"],
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
