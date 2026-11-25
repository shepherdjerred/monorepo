import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { PR_DRY_RUN_TIER } from "#src/pipeline/tiers.ts";
import { GLOBAL_SELECTOR_INPUTS } from "#src/pipeline/inputs.ts";
import { BUN_CACHE, BUN_CACHE_CONTROL } from "#src/pipeline/cache.ts";
import { GITHUB_DOWNLOAD } from "#src/pipeline/lanes/tofu.ts";

/**
 * Pull-request-only release rehearsal gate; automated code review runs via Temporal (ci/code-review).
 */

const DRY_RUN_SITES = [
  "statically-typed",
  "sjer.red",
  "resume",
  "webring",
  "cooklang-rich-preview",
  "stocks-sjer-red",
  "landing-pages",
  "cross-compilers-site",
  "wiki",
  "better-skill-capped",
  "glitter",
  "glitter-boys",
  "ts-mc-docs",
  "scout-design-system",
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
        // Print-only artifact publication rehearsals have no deployment authority.
        `for site in ${DRY_RUN_SITES.join(" ")}; do`,
        '  bun --no-install scripts/release/check-site-build.ts "$site"',
        "done",
        // Synthetic input is confined to print-only rehearsal, never published.
        `bun --no-install scripts/release/scout-site-release.ts prepare-state --build-number "$CI_RELEASE_NUMBER" --backend-digest sha256:${"f".repeat(64)} --output /tmp/scout-release-state.json --dry-run`,
        'bun --no-install packages/homelab/scripts/helm/helm-push.ts "$CI_RELEASE_NUMBER" --delivery-catalog --dry-run',
        "bun --no-install scripts/release/release.ts --dry-run",
      ],
      // No dependsOn: the dry run installs and builds its own filtered
      // subset and reads no verify handoff, so it runs alongside verify
      // instead of adding its own admission wait and runtime after it.
      timeoutMinutes: 30,
      resources: PR_DRY_RUN_TIER,
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
      secrets: [GITHUB_DOWNLOAD],
      volumes: [BUN_CACHE, BUN_CACHE_CONTROL],
    },
  ];
}
