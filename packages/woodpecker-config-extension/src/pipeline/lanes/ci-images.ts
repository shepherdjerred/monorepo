import type { CiImages } from "#src/images.ts";
import {
  DOCKERHUB_PUBLISH,
  DOCKERHUB_PUBLISH_LOGIN,
  DOCKERHUB_READ,
  DOCKERHUB_READ_LOGIN,
} from "#src/pipeline/lanes/registry.ts";
import type { CiStep, SecretGrant } from "#src/pipeline/model.ts";
import { IMAGE_ORCHESTRATION_TIER, LIGHT_TIER } from "#src/pipeline/tiers.ts";
import { GITHUB_DOWNLOAD, grant } from "#src/pipeline/lanes/tofu.ts";

/**
 * Toolchain image refreshes.
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

const DELIVERY_URL = "http://delivery.delivery.svc.cluster.local:7353";
const DELIVERY_PUBLISHER = grant(
  "ci-delivery-credentials",
  "DELIVERY_PUBLISHER_TOKEN",
  "DELIVERY_API_TOKEN",
);

type RefreshLane = {
  readonly lane: string;
  readonly names: readonly string[];
  readonly timeoutMinutes: number;
};

/**
 * Rebuild a family of toolchain images and pin each result. Under the v1
 * catalog the step also registers each promoted result as a Delivery build of
 * the `ci` service. Under the v2 catalog `ci` registers from the committed
 * pins instead (`ciServiceRegistrationStep`), so the refresh holds no
 * Delivery identity.
 *
 * The build, the pin and the registration are one step on purpose: an image
 * pushed but never pinned is invisible to every later build, and a pin written
 * for an image that failed to push would break every lane at once. The
 * registration needs the installed root-scripts closure (the Delivery client),
 * which the build and pin scripts do not.
 *
 * `lane` names the changed-path selector that decides whether anything needs
 * rebuilding; `names` are the images built from it, in order.
 */
function refreshStep(
  images: CiImages,
  { lane, names, timeoutMinutes }: RefreshLane,
  registers: boolean,
): CiStep {
  return {
    key: `${lane}-refresh`,
    label: `refresh ${lane} image${names.length > 1 ? "s" : ""}`,
    image: images.base,
    ...(registers ? { environment: { DELIVERY_URL } } : {}),
    commands: [
      `if ! bun --no-install ci/scripts/selectors/ci-changed.ts ${lane}; then exit 0; fi`,
      "MISE_TOOLCHAIN_SCOPE=automation . ci/scripts/toolchain.sh",
      "ci/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/root-scripts' --production",
      // The publisher login pushes the image and, under v1, reads it back for
      // registration.
      DOCKERHUB_PUBLISH_LOGIN,
      ...names.flatMap((name) => [
        `bun --no-install ci/scripts/images/build-ci-image.ts --image ${name} --candidate-out ${name}-candidate.json`,
        `bun --no-install ci/scripts/images/update-ci-image-pin.ts --candidate ${name}-candidate.json --outcome-out ${name}-promotion.json`,
        ...(registers
          ? [
              `bun --no-install ci/scripts/images/register-ci-image-build.ts --candidate ${name}-candidate.json --promotion ${name}-promotion.json`,
            ]
          : []),
      ]),
    ],
    dependsOn: ["verify"],
    timeoutMinutes,
    resources: IMAGE_ORCHESTRATION_TIER,
    defaultBranchOnly: true,
    concurrency: { limit: 1, group: `${lane}-refresh` },
    secrets: [
      GITHUB_DOWNLOAD,
      ...DOCKERHUB_PUBLISH,
      ...GITHUB_APP,
      ...(registers ? [DELIVERY_PUBLISHER] : []),
    ],
  };
}

/**
 * Register the `ci` service from the images this commit pins (v2 catalog).
 *
 * It runs in every main push pipeline rather than inside the refresh lane:
 * production refreshes run as manual maintenance pipelines, which the
 * qualifier refuses, and a candidate is not what CI runs until its pin
 * merges. The script registers one build covering every `ci` component,
 * retaining each pin Delivery already qualified, so Delivery composes the
 * first set of a new lineage and nothing when no digest changed. It reads
 * new pinned images back by digest with the registry reader identity.
 */
function ciServiceRegistrationStep(images: CiImages): CiStep {
  return {
    key: "ci-images-register",
    label: "register pinned CI images",
    image: images.base,
    environment: { DELIVERY_URL },
    commands: [
      "ci/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/root-scripts' --production",
      DOCKERHUB_READ_LOGIN,
      "bun --no-install ci/scripts/images/register-ci-service-build.ts",
    ],
    dependsOn: ["verify"],
    defaultBranchOnly: true,
    timeoutMinutes: 10,
    resources: LIGHT_TIER,
    secrets: [DOCKERHUB_READ, DELIVERY_PUBLISHER],
  };
}

export function ciImageSteps(images: CiImages, catalogV2 = false): CiStep[] {
  const refreshes = [
    { lane: "ci-base", names: ["ci-base"], timeoutMinutes: 60 },
    { lane: "ci-playwright", names: ["ci-playwright"], timeoutMinutes: 60 },
  ].map((lane) => refreshStep(images, lane, !catalogV2));
  return catalogV2
    ? [...refreshes, ciServiceRegistrationStep(images)]
    : refreshes;
}
