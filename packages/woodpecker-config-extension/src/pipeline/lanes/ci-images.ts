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
      ". ci/scripts/toolchain.sh",
      "bun --no-install ci/scripts/reporting/buildkit-env.ts",
      ...names.flatMap((name) => [
        `bun --no-install ci/scripts/images/build-ci-image.ts --image ${name} --candidate-out ${name}-candidate.json`,
        `bun --no-install ci/scripts/images/update-ci-image-pin.ts --candidate ${name}-candidate.json`,
      ]),
    ],
    dependsOn: ["verify"],
    timeoutMinutes,
    resources: VERIFY_TIER,
    defaultBranchOnly: true,
    concurrency: { limit: 1, group: `${lane}-refresh` },
    secrets: [GITHUB_DOWNLOAD, GHCR_PUSH, ...GITHUB_APP],
  };
}

/**
 * What can change the Windows cross-compiler images or their self-test.
 *
 * Deliberately without the global selector inputs every other lane carries:
 * the images are content-addressed from their own sources, so a pipeline edit
 * cannot change them, and re-running a multi-hour Wine and MSBuild build for
 * one would be pure cost. `ci/scripts/migration-core.ts` lists the same lane
 * in `lanesWithoutGlobalPaths` for the same reason.
 */
const WINDOWS_CROSS_COMPILER_CHANGED = {
  include: [
    "packages/windows-cross-compiler/**",
    "ci/scripts/images/application-image-runtime.ts",
    "ci/scripts/images/bake-retry.ts",
    "ci/scripts/images/build-ci-image-core.ts",
    "ci/scripts/images/build-ci-image.ts",
    "ci/scripts/images/selftest-ci-image.ts",
    "ci/scripts/images/update-ci-image-pin-core.ts",
    "ci/scripts/images/update-ci-image-pin-github.ts",
    "ci/scripts/images/update-ci-image-pin.ts",
    "ci/scripts/reporting/buildkit-env.ts",
    "scripts/lib/transient-error.ts",
  ],
} as const;

/**
 * Compile the Windows cross-compiler's sample programs inside the base and
 * WinUI images, on every pull request that could change them.
 *
 * Their consumers do not exercise every compiler the images ship, so this is
 * the only place a broken toolchain would show before a release. Nothing is
 * pushed: the build exports its logs locally and fails the solve when a check
 * fails, and those logs reach the step output directly -- Woodpecker has no
 * artifact store to upload them to.
 *
 * It holds the package-publishing token although it only reads. The build
 * imports its cache from the private `…/windows-cross-compiler:buildcache`
 * package, and without registry login BuildKit silently skips the cache and
 * rebuilds Wine and MSBuild from scratch, which does not fit this lane's
 * timeout. A read-only packages token would be tighter; until one exists this
 * matches the Buildkite lane it replaces, and `pr-reachable-secrets.test.ts`
 * records it as a known pull-request-reachable credential.
 */
function windowsCrossCompilerSelftestStep(images: CiImages): CiStep {
  return {
    key: "windows-cross-compiler-pr",
    label: "windows-cross-compiler self-test",
    image: images.base,
    commands: [
      ". ci/scripts/toolchain.sh",
      "bun --no-install ci/scripts/reporting/buildkit-env.ts",
      "bun --no-install ci/scripts/images/selftest-ci-image.ts",
    ],
    dependsOn: ["verify"],
    timeoutMinutes: 90,
    resources: VERIFY_TIER,
    events: ["pull_request"],
    changed: WINDOWS_CROSS_COMPILER_CHANGED,
    secrets: [GITHUB_DOWNLOAD, GHCR_PUSH],
  };
}

export function ciImageSteps(images: CiImages): CiStep[] {
  return [
    refreshStep(images, "ci-base", ["ci-base"], 60),
    refreshStep(images, "ci-playwright", ["ci-playwright"], 60),
    refreshStep(
      images,
      "windows-cross-compiler",
      ["windows-cross-compiler", "windows-cross-compiler-winui"],
      120,
    ),
    windowsCrossCompilerSelftestStep(images),
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
