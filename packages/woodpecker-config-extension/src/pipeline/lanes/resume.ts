import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { MEDIUM_TIER } from "#src/pipeline/tiers.ts";
import { GLOBAL_SELECTOR_INPUTS } from "#src/pipeline/inputs.ts";

/**
 * Build the resume PDF.
 *
 * Buildkite had this as two steps, `resume-build-pr` and `resume-build-main`,
 * with identical commands. The main variant differed only by a guard reading a
 * `ci-lane-run-resume` value the selector had precomputed and stashed in build
 * metadata. Selection now happens before any step is generated, so the guard
 * and the second step both disappear and one step covers both events.
 *
 * The built PDF is an input to the site deploy on the default branch, so it is
 * published to the handoff store rather than left in the workspace -- each
 * Woodpecker workflow gets its own.
 */
export function resumeSteps(images: CiImages): CiStep[] {
  return [
    {
      key: "resume-build",
      label: "resume",
      image: images.catalog["texlive/texlive"],
      commands: [
        // The image ships several TeX Live trees and does not put xelatex on
        // PATH; find it rather than hard-coding a year-stamped directory.
        'export PATH="$(dirname "$(find /usr/local/texlive -name xelatex | head -1)"):$PATH"',
        "cd packages/resume",
        "xelatex resume.tex",
      ],
      timeoutMinutes: 20,
      resources: MEDIUM_TIER,
      changed: {
        include: [
          ...GLOBAL_SELECTOR_INPUTS,
          "packages/resume/**",
          "scripts/release/deploy-site.ts",
          "scripts/lib/s3-static-site.ts",
          "scripts/lib/run.ts",
        ],
      },
    },
  ];
}
