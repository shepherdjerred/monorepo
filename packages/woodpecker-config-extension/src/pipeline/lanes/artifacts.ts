import type { CiImages } from "#src/images.ts";
import {
  DOCKERHUB_PUBLISH,
  DOCKERHUB_PUBLISH_LOGIN,
} from "#src/pipeline/lanes/registry.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { IMAGE_ORCHESTRATION_TIER, MEDIUM_TIER } from "#src/pipeline/tiers.ts";
import {
  GITHUB_DOWNLOAD,
  grant,
  HANDOFF_KEYS,
} from "#src/pipeline/lanes/tofu.ts";

const smokePath = "/tmp/caddyfile.generated";
const smokeVariable = "CADDYFILE_SMOKE_PATH";
const imageDigestsVariable = "HOMELAB_IMAGE_DIGESTS_JSON";

/** Build immutable candidates; Delivery independently qualifies and selects them. */
function chartPublicationRequested(): string[] {
  return [
    'image_digests="$(bun --no-install scripts/ci/read-ci-handoff.ts image-digests)"',
    "charts_requested=false",
    "for selector in helm argocd tofu tofu-platforms; do",
    '  if bun --no-install ci/scripts/selectors/ci-changed.ts "$selector"; then charts_requested=true; fi',
    "done",
    'if [ "$image_digests" != "{}" ]; then charts_requested=true; fi',
    'if [ "$charts_requested" != "true" ]; then exit 0; fi',
  ];
}

export function artifactPublicationSteps(
  images: CiImages,
  environment: Readonly<Record<string, string>>,
): CiStep[] {
  return [
    {
      key: "images",
      label: "build and publish images",
      image: images.base,
      environment,
      commands: [
        "ci/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/root-scripts' --production",
        "MISE_TOOLCHAIN_SCOPE=automation . ci/scripts/toolchain.sh",
        DOCKERHUB_PUBLISH_LOGIN,
        "bun --no-install scripts/ci/read-ci-handoff.ts caddyfile | jq -r . > /tmp/caddyfile.generated",
        `${smokeVariable}=${smokePath} bun --no-install ci/scripts/images/bake-images.ts --push`,
      ],
      dependsOn: ["verify"],
      timeoutMinutes: 60,
      resources: IMAGE_ORCHESTRATION_TIER,
      defaultBranchOnly: true,
      concurrency: { limit: 1, group: "image-push" },
      secrets: [GITHUB_DOWNLOAD, ...DOCKERHUB_PUBLISH, ...HANDOFF_KEYS],
    },
    {
      key: "helm-push",
      label: "build and publish Helm charts",
      image: images.base,
      environment,
      commands: [
        "ci/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/root-scripts' --filter homelab --filter '@homelab/cdk8s' --production",
        ...chartPublicationRequested(),
        "MISE_TOOLCHAIN_SCOPE=deployment . ci/scripts/toolchain.sh",
        `export ${imageDigestsVariable}="$image_digests"`,
        'export HOMELAB_VERSION_CATALOG_JSON="$(bun --no-install scripts/ci/read-ci-handoff.ts version-catalog)"',
        'export HOMELAB_RELEASE_VERSION="2.0.0-$CI_RELEASE_NUMBER"',
        'bun --no-install packages/homelab/scripts/helm/helm-push.ts "$CI_RELEASE_NUMBER" --delivery-catalog',
        "bun --no-install scripts/ci/write-ci-handoff.ts argocd-release-expected < argocd-release-expected.json",
        "bun --no-install scripts/ci/write-ci-handoff.ts helm-release-plan < helm-release-plan.json",
        "bun --no-install scripts/ci/write-ci-handoff.ts delivery-chart-publications < delivery-chart-publications.json",
      ],
      dependsOn: ["images", "ci-base-refresh", "ci-playwright-refresh"],
      timeoutMinutes: 60,
      resources: MEDIUM_TIER,
      defaultBranchOnly: true,
      concurrency: { limit: 1, group: "chart-publication" },
      secrets: [
        GITHUB_DOWNLOAD,
        ...HANDOFF_KEYS,
        grant("ci-chartmuseum-credentials", "CHARTMUSEUM_USERNAME"),
        grant("ci-chartmuseum-credentials", "CHARTMUSEUM_PASSWORD"),
      ],
    },
  ];
}
