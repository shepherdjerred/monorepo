import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { MEDIUM_TIER, VERIFY_TIER } from "#src/pipeline/tiers.ts";
import { GLOBAL_SELECTOR_INPUTS } from "#src/pipeline/inputs.ts";
import {
  GITHUB_DOWNLOAD,
  STATE_BACKEND,
  grant,
} from "#src/pipeline/lanes/tofu.ts";

/**
 * Pull-request-only gates: the release rehearsal and the automated review.
 */

/**
 * Stand-in for Buildkite's build UUID, which Woodpecker has no equivalent of.
 *
 * ArgoCD's release-root wants a UUID-shaped request id to attribute an
 * operation to one build. The pipeline number is unique per build, so it is
 * formatted into a valid UUID rather than invented randomly -- a random id
 * would make a retried dry run look like a different requester.
 */
const SYNTHETIC_REQUEST_ID =
  'request_id="00000000-0000-4000-8000-$(printf \'%012d\' "$CI_PIPELINE_NUMBER")"';

const DRY_RUN_SITES = [
  "sjer.red",
  "resume",
  "webring",
  "cooklang-rich-preview",
  "stocks-sjer-red",
  "wiki",
  "better-skill-capped",
  "glitter",
];

export function prGateSteps(images: CiImages): CiStep[] {
  return [
    {
      key: "pr-dryrun",
      label: "release dry run",
      image: images.base,
      commands: [
        ". ci/scripts/toolchain.sh",
        "ci/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/root-scripts' --filter '@shepherdjerred/release-tools' --filter '@shepherdjerred/llm-models' --filter homelab --filter '@homelab/cdk8s'",
        "bun --no-install run --cwd packages/llm-models build",
        // Helm value-types drift gate. PR-only by design: the inputs are
        // fully version-pinned, so a green PR gate implies a green main tree.
        // A Renovate chart bump fails here until the regen commit lands,
        // because hosted Renovate cannot run the generator itself.
        "if bun --no-install ci/scripts/selectors/ci-changed.ts helm-types; then",
        "  bun --no-install run --cwd packages/homelab/src/cdk8s generate-helm-types --check",
        "fi",
        // Print-only rehearsals, seconds each: the site catalog, the whole
        // versioned Scout release path, the chart push, and release-please.
        `for site in ${DRY_RUN_SITES.join(" ")}; do`,
        '  bun --no-install scripts/release/deploy-site.ts "$site" --dry-run',
        "done",
        'scout_backend="$(bun --no-install scripts/release/scout-site-release.ts resolve-backend-digest)"',
        'bun --no-install scripts/release/scout-site-release.ts prepare-state --build-number "$CI_PIPELINE_NUMBER" --backend-digest "$scout_backend" --output /tmp/scout-release-state.json --dry-run',
        'scout_state="$(cat /tmp/scout-release-state.json)"',
        'bun --no-install scripts/release/scout-site-release.ts archive --state "$scout_state" --dry-run',
        'bun --no-install scripts/release/scout-site-release.ts deploy-beta --state "$scout_state" --dry-run',
        'bun --no-install scripts/release/scout-site-release.ts reconcile-prod --state "$scout_state" --dry-run',
        'bun --no-install scripts/release/scout-site-release.ts tag-release --state "$scout_state" --dry-run',
        "bun --no-install scripts/release/scout-site-release.ts resolve-prod-pin",
        'bun --no-install packages/homelab/scripts/helm/helm-push.ts "$CI_PIPELINE_NUMBER" --dry-run',
        'apps_revision="$(jq -er \'.[] | select(.name == "apps") | .revision\' argocd-release-expected.json)"',
        SYNTHETIC_REQUEST_ID,
        'bun --no-install packages/homelab/scripts/argocd/argocd.ts release-root apps argocd-release-expected.json --revision "$apps_revision" --request-id "$request_id" --dry-run',
        'pin_candidates="$(jq -cn --arg build "$CI_PIPELINE_NUMBER" \'{schema:"pin-candidates/v1",buildNumber:($build|tonumber),candidates:{}}\')"',
        'bun --no-install scripts/release/update-versions.ts --commit-back --candidates "$pin_candidates" --dry-run',
        "bun --no-install scripts/release/release.ts --dry-run",
      ],
      dependsOn: ["verify"],
      timeoutMinutes: 30,
      resources: VERIFY_TIER,
      events: ["pull_request"],
      changed: {
        include: [
          ...GLOBAL_SELECTOR_INPUTS,
          "bun.lock",
          "bunfig.toml",
          "package.json",
          "packages/**/package.json",
          "patches/**",
          "turbo.json",
          "release-please-config.json",
          ".release-please-manifest.json",
          "docker-bake.hcl",
          ".dockerignore",
          "scripts/**",
          "packages/homelab/**",
          "packages/version-catalog/**",
          "packages/scout-for-lol/**",
        ],
      },
      secrets: [
        GITHUB_DOWNLOAD,
        ...STATE_BACKEND,
        grant("ci-argocd-credentials", "ARGOCD_AUTH_TOKEN"),
      ],
    },
    {
      key: "codex-review-gate",
      label: "automated review gate",
      image: images.base,
      commands: [". ci/scripts/toolchain.sh", "ci/scripts/review-gate.sh"],
      timeoutMinutes: 90,
      resources: MEDIUM_TIER,
      events: ["pull_request"],
      // Codex's auth bundle carries a refresh token, so it must outlive the
      // ephemeral step pod.
      volumes: [
        { claim: "woodpecker-codex-auth", path: "/woodpecker/codex-auth" },
      ],
      secrets: [
        GITHUB_DOWNLOAD,
        grant("ci-github-credentials", "GITHUB_REVIEW_TOKEN"),
        grant("ci-github-credentials", "GITHUB_APP_ID"),
        grant("ci-github-credentials", "GITHUB_APP_INSTALLATION_ID"),
        grant("ci-github-credentials", "GITHUB_APP_PRIVATE_KEY"),
        grant("ci-release-openrouter-credentials", "OPENROUTER_API_KEY"),
      ],
    },
  ];
}
