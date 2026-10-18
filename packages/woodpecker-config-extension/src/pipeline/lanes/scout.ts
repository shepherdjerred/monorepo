import type { CiImages } from "#src/images.ts";
import {
  DOCKERHUB_READ,
  DOCKERHUB_READ_LOGIN,
} from "#src/pipeline/lanes/registry.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { MEDIUM_TIER, VERIFY_TIER } from "#src/pipeline/tiers.ts";
import {
  DELIVERY_ARCHIVE_KEYS,
  HANDOFF_KEYS,
  GITHUB_DOWNLOAD,
  grant,
} from "#src/pipeline/lanes/tofu.ts";

const SCOUT_WORKSPACE_FILTERS = [
  "--filter '@shepherdjerred/root-scripts'",
  "--filter '@scout-for-lol/frontend'",
  "--filter '@scout-for-lol/app'",
  "--filter '@scout-for-lol/activity'",
  "--filter '@scout-for-lol/docs-site'",
  "--filter '@scout-for-lol/design-system'",
  "--filter scout-for-lol",
  "--filter astro-opengraph-images",
  "--filter '@shepherdjerred/llm-models'",
  "--filter '@shepherdjerred/glitter-context'",
].join(" ");

/** CI publishes both immutable frontend flavors against one exact backend; Delivery owns activation and approval. */
export function scoutSteps(images: CiImages): CiStep[] {
  return [
    {
      key: "scout-site-archives",
      label: "publish Scout site archives",
      image: images.base,
      commands: [
        "ci/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/root-scripts' --production",
        "printf '[]' | bun --no-install scripts/ci/write-ci-handoff.ts scout-site-artifacts",
        'scout_delivery_candidate="$(bun --no-install scripts/ci/read-ci-handoff.ts delivery-image-digests | jq -r \'."shepherdjerred/scout-for-lol" // empty\')"',
        "scout_source_changed=false",
        "if bun --no-install ci/scripts/selectors/ci-changed.ts site-scout; then scout_source_changed=true; fi",
        'if [ -z "$scout_delivery_candidate" ] && [ "$scout_source_changed" != "true" ]; then exit 0; fi',
        ". ci/scripts/toolchain.sh",
        `ci/scripts/bun-install.sh --frozen-lockfile ${SCOUT_WORKSPACE_FILTERS}`,
        "bun --no-install run --cwd packages/llm-models build",
        "bun --no-install run --cwd packages/astro-opengraph-images build",
        "bun --no-install run --cwd packages/glitter-context build",
        DOCKERHUB_READ_LOGIN,
        'scout_delivery_backend="$(bun --no-install scripts/release/resolve-scout-delivery-backend.ts)"',
        'bun --no-install scripts/release/scout-site-release.ts prepare-state --delivery-archive --build-number "$CI_RELEASE_NUMBER" --backend-digest "$scout_delivery_backend" --output .delivery-artifacts/scout-release/state.json',
        "bun --no-install scripts/release/publish-scout-site-archives.ts .delivery-artifacts/scout-release/state.json",
      ],
      environment: {
        DELIVERY_URL: "http://delivery.delivery.svc.cluster.local:7353",
      },
      dependsOn: ["images"],
      timeoutMinutes: 30,
      resources: VERIFY_TIER,
      defaultBranchOnly: true,
      concurrency: { limit: 1, group: "site-archives" },
      secrets: [
        GITHUB_DOWNLOAD,
        DOCKERHUB_READ,
        ...DELIVERY_ARCHIVE_KEYS,
        ...HANDOFF_KEYS,
        grant(
          "ci-delivery-credentials",
          "DELIVERY_PUBLISHER_TOKEN",
          "DELIVERY_API_TOKEN",
        ),
      ],
    },
    releasePleaseStep(images),
  ];
}

/** Package/repository release automation remains separate from hosted workload deployment. */
function releasePleaseStep(images: CiImages): CiStep {
  return {
    key: "release-please",
    label: "release please",
    image: images.base,
    commands: [
      "MISE_TOOLCHAIN_SCOPE=automation . ci/scripts/toolchain.sh",
      "ci/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/root-scripts' --filter '@shepherdjerred/release-tools' --filter '@shepherdjerred/llm-models' --production",
      "bun --no-install run --cwd packages/llm-models build:runtime",
      "bun --no-install scripts/release/release.ts",
    ],
    dependsOn: ["verify"],
    timeoutMinutes: 60,
    resources: MEDIUM_TIER,
    defaultBranchOnly: true,
    concurrency: { limit: 1, group: "release-please" },
    secrets: [
      GITHUB_DOWNLOAD,
      grant("ci-release-openai-credentials", "OPENAI_API_KEY"),
      grant("ci-github-credentials", "GITHUB_APP_ID"),
      grant("ci-github-credentials", "GITHUB_APP_INSTALLATION_ID"),
      grant("ci-github-credentials", "GITHUB_APP_PRIVATE_KEY"),
    ],
  };
}

/** Publication has no inference credential when refinement runs separately. */
export function githubReleaseStep(step: CiStep): CiStep {
  if (step.key !== "release-please") throw new Error("Expected release lane");
  return {
    ...step,
    label: "publish GitHub releases",
    commands: step.commands.map((command) =>
      command === "bun --no-install scripts/release/release.ts"
        ? `${command} --phase github-release`
        : command,
    ),
    secrets:
      step.secrets?.filter((secret) => secret.env !== "OPENAI_API_KEY") ?? [],
  };
}
