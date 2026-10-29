import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { LIGHT_TIER } from "#src/pipeline/tiers.ts";
import {
  DELIVERY_ARCHIVE_KEYS,
  GITHUB_DOWNLOAD,
  HANDOFF_KEYS,
  grant,
} from "#src/pipeline/lanes/tofu.ts";
import {
  DOCKERHUB_READ,
  DOCKERHUB_READ_LOGIN,
} from "#src/pipeline/lanes/registry.ts";

/** Registration does not wait for this pipeline's verdict; Temporal qualifies it. */
export function deliveryPublicationSteps(
  images: CiImages,
  enabled: boolean,
  staticArchives = false,
  catalogV2 = false,
): CiStep[] {
  if (!enabled) return [];
  return [
    {
      key: "delivery-publish",
      label: "register Delivery artifacts",
      image: images.base,
      commands: [
        // Publication reads homelab's Tofu stack manifest, whose own imports
        // (ops-model) resolve only from homelab's installed closure.
        "ci/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/root-scripts' --filter homelab --production",
        DOCKERHUB_READ_LOGIN,
        `bun --no-install scripts/ci/publish-delivery.ts${staticArchives ? " --static-archives" : ""}${catalogV2 ? " --catalog-v2" : ""}`,
      ],
      environment: {
        DELIVERY_URL: "http://delivery.delivery.svc.cluster.local:7353",
      },
      dependsOn: [
        "verify",
        "images",
        "helm-push",
        "trmnl-plugin-archives",
        ...(catalogV2 ? ["tofu-archives", "npm-package-archives"] : []),
        ...(staticArchives ? ["sites", "scout-site-archives"] : []),
      ],
      defaultBranchOnly: true,
      timeoutMinutes: 5,
      resources: LIGHT_TIER,
      secrets: [
        GITHUB_DOWNLOAD,
        ...HANDOFF_KEYS,
        DOCKERHUB_READ,
        grant("ci-chartmuseum-credentials", "CHARTMUSEUM_USERNAME"),
        grant("ci-chartmuseum-credentials", "CHARTMUSEUM_PASSWORD"),
        grant(
          "ci-delivery-credentials",
          "DELIVERY_PUBLISHER_TOKEN",
          "DELIVERY_API_TOKEN",
        ),
        // Under the catalog, GitHub source acquisitions store their commit
        // tarballs in the immutable artifact bucket.
        ...(catalogV2 ? DELIVERY_ARCHIVE_KEYS : []),
      ],
    },
  ];
}
