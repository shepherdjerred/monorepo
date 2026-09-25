import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { CROSS_BUILD_TIER } from "#src/pipeline/tiers.ts";

/**
 * TaskNotes for Windows, built on Linux.
 *
 * The WinUI cross-compiler image restores, builds, and packages every Windows
 * project, including the app's MSIX. Pull requests only: this proves the app
 * still builds; releases are cut elsewhere.
 *
 * Buildkite also kept the MSIX as a build artifact. Woodpecker has no artifact
 * store and nothing consumed it, so the package is built and discarded; the
 * lane's value is that the build succeeds.
 */
export function tasknotesWindowsSteps(images: CiImages): CiStep[] {
  return [
    {
      key: "tasknotes-windows-cross",
      label: "TaskNotes Windows cross-build",
      image: images.windowsCrossCompilerWinui,
      commands: [
        "cd packages/tasknotes-windows",
        "scripts/cross-build.sh AppPackages/cross",
      ],
      timeoutMinutes: 60,
      resources: CROSS_BUILD_TIER,
      events: ["pull_request"],
      // Exactly the Buildkite lane's inputs: the app, the Rust core it binds,
      // the pinned compiler image, and the .NET SDK pin.
      changed: {
        include: [
          "packages/tasknotes-windows/**",
          "packages/tasknotes-core/**",
          "packages/windows-cross-compiler/images/windows-cross-compiler-winui/DIGEST",
          "global.json",
        ],
      },
    },
  ];
}
