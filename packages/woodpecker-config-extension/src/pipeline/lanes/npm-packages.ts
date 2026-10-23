import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { MEDIUM_TIER } from "#src/pipeline/tiers.ts";
import {
  DELIVERY_ARCHIVE_KEYS,
  GITHUB_DOWNLOAD,
  HANDOFF_KEYS,
} from "#src/pipeline/lanes/tofu.ts";

/**
 * Every npm channel package's tarball, frozen in `delivery-artifacts` on
 * every main run under the v2 catalog. Delivery decides by digest whether
 * it is new, and the channel deployment publishes it to npm (X12): the
 * step holds the archive-publisher and handoff identities, never an npm
 * token.
 */
export function npmPackageArchiveSteps(images: CiImages): CiStep[] {
  return [
    {
      key: "npm-package-archives",
      label: "freeze npm package archives",
      image: images.base,
      commands: [
        "MISE_TOOLCHAIN_SCOPE=deployment . ci/scripts/toolchain.sh",
        "ci/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/root-scripts' --filter webring",
        "bun --no-install scripts/ci/publish-npm-package-archives.ts",
      ],
      dependsOn: ["verify"],
      timeoutMinutes: 15,
      resources: MEDIUM_TIER,
      defaultBranchOnly: true,
      concurrency: { limit: 1, group: "npm-package-archives" },
      secrets: [GITHUB_DOWNLOAD, ...DELIVERY_ARCHIVE_KEYS, ...HANDOFF_KEYS],
    },
  ];
}
