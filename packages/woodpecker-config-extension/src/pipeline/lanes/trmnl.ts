import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { CONTAINED_TIER } from "#src/pipeline/tiers.ts";
import { GLOBAL_SELECTOR_INPUTS } from "#src/pipeline/inputs.ts";
import {
  DELIVERY_ARCHIVE_KEYS,
  HANDOFF_KEYS,
  GITHUB_DOWNLOAD,
  grant,
} from "#src/pipeline/lanes/tofu.ts";

/**
 * Validate and publish immutable TRMNL packages. Delivery owns external updates.
 */
const TRMNL_CHANGED = {
  include: [
    ...GLOBAL_SELECTOR_INPUTS,
    "packages/trmnl-dashboard/**",
    "packages/ops-model/src/trmnl/**",
  ],
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
      changed: TRMNL_CHANGED,
    },
    {
      key: "trmnl-plugin-archives",
      label: "publish verified source and TRMNL archives",
      image: images.base,
      commands: [
        "ci/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/root-scripts' --production",
        "bun --no-install scripts/ci/trmnl/publish-plugins.ts",
      ],
      environment: {
        DELIVERY_URL: "http://delivery.delivery.svc.cluster.local:7353",
      },
      dependsOn: ["images", "trmnl-validate"],
      timeoutMinutes: 20,
      resources: CONTAINED_TIER,
      defaultBranchOnly: true,
      secrets: [
        GITHUB_DOWNLOAD,
        ...DELIVERY_ARCHIVE_KEYS,
        ...HANDOFF_KEYS,
        grant(
          "ci-delivery-credentials",
          "DELIVERY_PUBLISHER_TOKEN",
          "DELIVERY_API_TOKEN",
        ),
      ],
    },
  ];
}
