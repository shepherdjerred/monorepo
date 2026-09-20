import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { MEDIUM_TIER, VERIFY_TIER } from "#src/pipeline/tiers.ts";
import {
  DEPLOY_KEYS,
  HANDOFF_KEYS,
  GITHUB_DOWNLOAD,
  grant,
} from "#src/pipeline/lanes/tofu.ts";

/**
 * Scout's site release: archive, beta deploy, tag, and production reconcile.
 *
 * The four lanes are bound together by one state document. scout-beta-release
 * writes it; the others read it and stop if it is absent, which is how a build
 * that released nothing avoids tagging or reconciling anything. That document
 * binds the tag to the backend digest, both site archives, and the source
 * commit, so the pieces of one release cannot be mixed across builds.
 */

const SITE_DEPLOY_GROUP = { limit: 1, group: "site-deploys" } as const;

/**
 * The aws CLI and the release scripts read the standard AWS names, while the
 * grants keep the SeaweedFS-specific ones so a leaked value is traceable to
 * this system.
 */
const AWS_ALIASES = [
  'export AWS_ACCESS_KEY_ID="$SEAWEEDFS_SITES_ACCESS_KEY_ID"',
  'export AWS_SECRET_ACCESS_KEY="$SEAWEEDFS_SITES_SECRET_ACCESS_KEY"',
];

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

export function scoutSteps(images: CiImages): CiStep[] {
  return [
    {
      key: "scout-beta-release",
      label: "scout beta release",
      image: images.base,
      commands: [
        // Release when this build pushed a Scout backend image, or when the
        // site sources changed on their own.
        'scout_candidate="$(bun --no-install scripts/ci/read-ci-handoff.ts image-digests | jq -r \'."shepherdjerred/scout-for-lol/beta" // empty\')"',
        "scout_source_changed=false",
        "if bun --no-install ci/scripts/selectors/ci-changed.ts site-scout; then scout_source_changed=true; fi",
        'if [ -z "$scout_candidate" ] && [ "$scout_source_changed" != "true" ]; then exit 0; fi',
        ". ci/scripts/toolchain.sh",
        `ci/scripts/bun-install.sh --frozen-lockfile ${SCOUT_WORKSPACE_FILTERS}`,
        "bun --no-install run --cwd packages/llm-models build",
        "bun --no-install run --cwd packages/astro-opengraph-images build",
        "bun --no-install run --cwd packages/glitter-context build",
        ...AWS_ALIASES,
        'if [ -n "$scout_candidate" ]; then',
        '  scout_backend="$(bun --no-install scripts/release/scout-site-release.ts resolve-backend-digest --candidate-digest "$scout_candidate")"',
        "else",
        '  scout_backend="$(bun --no-install scripts/release/scout-site-release.ts resolve-backend-digest)"',
        "fi",
        "mkdir -p .scout-release",
        'bun --no-install scripts/release/scout-site-release.ts prepare-state --build-number "$CI_PIPELINE_NUMBER" --backend-digest "$scout_backend" --output .scout-release/state.json',
        'scout_state="$(cat .scout-release/state.json)"',
        'bun --no-install scripts/release/scout-site-release.ts archive --state "$scout_state"',
        // Published before the beta deploy so a failed deploy still leaves the
        // tag and reconcile lanes able to see what was archived.
        "bun --no-install scripts/ci/write-ci-handoff.ts scout-release-state < .scout-release/state.json",
        'bun --no-install scripts/release/scout-site-release.ts deploy-beta --state "$scout_state"',
      ],
      dependsOn: ["images", "argocd-sync"],
      timeoutMinutes: 30,
      resources: VERIFY_TIER,
      defaultBranchOnly: true,
      concurrency: SITE_DEPLOY_GROUP,
      secrets: [GITHUB_DOWNLOAD, ...DEPLOY_KEYS, ...HANDOFF_KEYS],
    },
    {
      key: "scout-tag-release",
      label: "scout tag release",
      image: images.base,
      commands: [
        // Absent state is a real outcome here: this build released nothing.
        'scout_state="$(bun --no-install scripts/ci/read-optional-ci-handoff.ts scout-release-state)"',
        'if [ -z "$scout_state" ]; then exit 0; fi',
        ". ci/scripts/toolchain.sh",
        "ci/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/root-scripts' --production",
        ...AWS_ALIASES,
        "printf '%s' \"$GITHUB_PACKAGES_TOKEN\" | docker login ghcr.io -u shepherdjerred --password-stdin",
        'bun --no-install scripts/release/scout-site-release.ts tag-release --state "$scout_state"',
      ],
      dependsOn: ["scout-beta-release"],
      timeoutMinutes: 30,
      resources: MEDIUM_TIER,
      defaultBranchOnly: true,
      secrets: [
        GITHUB_DOWNLOAD,
        grant("ci-github-credentials", "GITHUB_PACKAGES_TOKEN"),
        ...DEPLOY_KEYS,
        ...HANDOFF_KEYS,
      ],
    },
    {
      key: "scout-prod-reconcile",
      label: "scout production reconcile",
      image: images.base,
      commands: [
        "if ! bun --no-install ci/scripts/selectors/ci-changed.ts scout-reconcile; then exit 0; fi",
        ". ci/scripts/toolchain.sh",
        "ci/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/root-scripts' --production",
        ...AWS_ALIASES,
        'prod_pin="$(bun --no-install scripts/release/scout-site-release.ts resolve-prod-pin)"',
        'bun --no-install scripts/release/scout-site-release.ts reconcile-prod-pin --prod-pin "$prod_pin"',
      ],
      dependsOn: ["argocd-sync", "scout-beta-release"],
      timeoutMinutes: 30,
      resources: MEDIUM_TIER,
      defaultBranchOnly: true,
      concurrency: SITE_DEPLOY_GROUP,
      secrets: [GITHUB_DOWNLOAD, ...DEPLOY_KEYS],
    },
    {
      key: "release-please",
      label: "release please",
      image: images.base,
      commands: [
        ". ci/scripts/toolchain.sh",
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
        grant("ci-github-credentials", "GITHUB_APP_ID"),
        grant("ci-github-credentials", "GITHUB_APP_INSTALLATION_ID"),
        grant("ci-github-credentials", "GITHUB_APP_PRIVATE_KEY"),
        grant("ci-release-openrouter-credentials", "OPENROUTER_API_KEY"),
      ],
    },
  ];
}
