import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { VERIFY_TIER } from "#src/pipeline/tiers.ts";
import {
  APPLE_SDKS_KEYS,
  GITHUB_DOWNLOAD,
  grant,
} from "#src/pipeline/lanes/tofu.ts";

/**
 * The macos-cross-compiler images: Linux containers that build for Apple
 * platforms from the real Xcode SDKs.
 *
 * Both lanes build through the cluster's BuildKit service and read the SDK
 * tarballs from the private `apple-sdks` bucket with a read-only identity. The
 * images themselves are not CI toolchain images -- nothing here runs inside
 * them -- which is why they sit apart from `ci-images.ts`.
 */

/**
 * The script reads the standard AWS names; the grants keep SeaweedFS-specific
 * ones so a leaked value is traceable to this system.
 */
const SDK_READ_ALIASES = [
  'export AWS_ACCESS_KEY_ID="$SEAWEEDFS_APPLE_SDKS_ACCESS_KEY_ID"',
  'export AWS_SECRET_ACCESS_KEY="$SEAWEEDFS_APPLE_SDKS_SECRET_ACCESS_KEY"',
];

const INSTALL = [
  ". ci/scripts/toolchain.sh",
  "ci/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/root-scripts'",
];

/**
 * What can change the smoke build. `seaweedfs.ts` rather than the
 * `s3-static-site.ts` the Buildkite lane named: the SeaweedFS constants the
 * script imports live there on this branch.
 */
const MACOS_CROSS_COMPILER_CHANGED = {
  include: [
    "packages/macos-cross-compiler/**",
    "scripts/release/macos-cross-compiler.ts",
    "scripts/lib/run.ts",
    "scripts/lib/seaweedfs.ts",
  ],
} as const;

export function macosCrossCompilerSteps(images: CiImages): CiStep[] {
  return [
    {
      key: "macos-cross-compiler-pr",
      label: "macos-cross-compiler smoke",
      image: images.base,
      commands: [
        ...INSTALL,
        ...SDK_READ_ALIASES,
        "bun --no-install scripts/release/macos-cross-compiler.ts smoke",
      ],
      timeoutMinutes: 120,
      resources: VERIFY_TIER,
      events: ["pull_request"],
      changed: MACOS_CROSS_COMPILER_CHANGED,
      secrets: [GITHUB_DOWNLOAD, ...APPLE_SDKS_KEYS],
    },
    {
      key: "macos-cross-compiler",
      label: "macos-cross-compiler build, smoke, publish",
      image: images.base,
      commands: [
        "if ! bun --no-install ci/scripts/selectors/ci-changed.ts macos-cross-compiler; then exit 0; fi",
        ...INSTALL,
        // The script pushes images and a registry cache without logging in, so
        // it relies on Docker credentials being present -- as the other image
        // lanes do, by running this first.
        "bun --no-install ci/scripts/reporting/buildkit-env.ts",
        ...SDK_READ_ALIASES,
        "bun --no-install scripts/release/macos-cross-compiler.ts push",
      ],
      dependsOn: ["verify"],
      timeoutMinutes: 240,
      resources: VERIFY_TIER,
      defaultBranchOnly: true,
      concurrency: { limit: 1, group: "macos-cross-compiler-push" },
      secrets: [
        GITHUB_DOWNLOAD,
        grant("ci-github-credentials", "GITHUB_PACKAGES_TOKEN"),
        ...APPLE_SDKS_KEYS,
      ],
    },
  ];
}
