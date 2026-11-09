import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { MEDIUM_TIER } from "#src/pipeline/tiers.ts";
import { GLOBAL_SELECTOR_INPUTS } from "#src/pipeline/inputs.ts";
import { GITHUB_DOWNLOAD, HANDOFF_KEYS } from "#src/pipeline/lanes/tofu.ts";

/**
 * Build the resume PDF.
 *
 * Selection happens before any step is generated, so one step covers both
 * pull requests and the default branch.
 *
 * The built PDF is an input to the site deploy on the default branch, so it is
 * published to the handoff store rather than left in the workspace -- each
 * Woodpecker workflow gets its own.
 *
 * The TeX Live image only compiles. Publishing needs the repo-pinned Bun,
 * which the toolchain image already carries, so an ordered container on that
 * image uploads the PDF from the shared checkout. Running the upload in the
 * TeX Live image instead would bootstrap mise from the network on every run.
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
      timeoutMinutes: 10,
      resources: MEDIUM_TIER,
      orderedSteps: [
        {
          key: "resume-publish",
          image: images.base,
          commands: [
            "MISE_TOOLCHAIN_SCOPE=runtime . ci/scripts/toolchain.sh",
            "ci/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/root-scripts' --production",
            // The deploy lane consumes this with --prebuilt rather than
            // reinstalling a TeX toolchain to rebuild it.
            "bun --no-install scripts/ci/ci-artifact.ts put resume-pdf",
          ],
          timeoutMinutes: 10,
          resources: MEDIUM_TIER,
          secrets: [GITHUB_DOWNLOAD, ...HANDOFF_KEYS],
        },
      ],
      changed: {
        include: [
          ...GLOBAL_SELECTOR_INPUTS,
          "packages/resume/**",
          "scripts/release/check-site-build.ts",
          "scripts/lib/s3-static-site.ts",
          "scripts/lib/run.ts",
        ],
      },
    },
  ];
}
