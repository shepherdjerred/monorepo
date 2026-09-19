import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { CONTAINED_TIER } from "#src/pipeline/tiers.ts";
import { GLOBAL_SELECTOR_INPUTS } from "#src/pipeline/inputs.ts";

/**
 * TRMNL dashboard validation and publish.
 *
 * Unlike the resume lane, these stay two steps: the PR lane validates and the
 * main lane publishes, so they run different commands and only one of them
 * holds a credential. Publishing is serialized because it mutates a single
 * external dashboard -- two concurrent publishes would race to decide which
 * revision the device shows.
 */
const TRMNL_CHANGED = {
  include: [...GLOBAL_SELECTOR_INPUTS, "packages/trmnl-dashboard/**"],
} as const;

export function trmnlSteps(images: CiImages): CiStep[] {
  const image = images.catalog["trmnl/trmnlp"];
  return [
    {
      key: "trmnl-validate",
      label: "trmnl validate",
      image,
      commands: [
        "packages/trmnl-dashboard/scripts/trmnlp-ci.sh self-test",
        "packages/trmnl-dashboard/scripts/trmnlp-ci.sh validate",
      ],
      timeoutMinutes: 20,
      resources: CONTAINED_TIER,
      events: ["pull_request"],
      changed: TRMNL_CHANGED,
    },
    {
      key: "trmnl-publish",
      label: "trmnl publish",
      image,
      commands: ["packages/trmnl-dashboard/scripts/trmnlp-ci.sh publish"],
      timeoutMinutes: 20,
      resources: CONTAINED_TIER,
      defaultBranchOnly: true,
      concurrency: { limit: 1, group: "trmnl-publish" },
      secrets: [
        {
          secret: "ci-trmnl-credentials",
          key: "TRMNL_API_KEY",
          env: "TRMNL_API_KEY",
        },
      ],
      changed: TRMNL_CHANGED,
    },
  ];
}
