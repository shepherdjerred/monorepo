import type { CiImages } from "#src/images.ts";
import type { CiStep, SecretGrant } from "#src/pipeline/model.ts";
import { VERIFY_TIER } from "#src/pipeline/tiers.ts";
import { GITHUB_DOWNLOAD, grant } from "#src/pipeline/lanes/tofu.ts";

/**
 * Static site deploys and package publishing.
 *
 * Both lanes select per-target inside the step rather than at pipeline level,
 * because one lane covers eight sites (or two publish groups) and each has its
 * own answer. Selection decides whether the LANE runs; the step decides which
 * targets within it do.
 *
 * The Buildkite `sites` lane also contained a block that re-ran every per-site
 * check on the early-exit path purely so the build-summary annotation could
 * show "skipped" rather than "not recorded" for each row. That annotation is
 * gone, and so is the block -- it did no work and produced no output anyone
 * reads.
 */

const SITE_DEPLOY_GROUP = { limit: 1, group: "site-deploys" } as const;

const DEPLOY_KEYS: readonly SecretGrant[] = [
  grant("ci-seaweedfs-credentials", "SEAWEEDFS_DEPLOY_ACCESS_KEY_ID"),
  grant("ci-seaweedfs-credentials", "SEAWEEDFS_DEPLOY_SECRET_ACCESS_KEY"),
];

/**
 * Site syncs use the deployment identity; the OpenTofu lanes use a separate
 * state identity, and the two are deliberately not interchangeable.
 */
const AWS_ALIASES = [
  'export AWS_ACCESS_KEY_ID="$SEAWEEDFS_DEPLOY_ACCESS_KEY_ID"',
  'export AWS_SECRET_ACCESS_KEY="$SEAWEEDFS_DEPLOY_SECRET_ACCESS_KEY"',
];

/** Sites built from source in this step, with the workspace each needs. */
const SOURCE_BUILT_SITES = [
  { lane: "site-webring", site: "webring", filter: "webring" },
  {
    lane: "site-cooklang",
    site: "cooklang-rich-preview",
    filter: "'@shepherdjerred/cooklang-rich-preview'",
  },
  { lane: "site-stocks", site: "stocks-sjer-red", filter: "stocks-sjer-red" },
  {
    lane: "site-better-skill-capped",
    site: "better-skill-capped",
    filter: "better-skill-capped",
  },
  // The build reaches @shepherdjerred/glitter-context through Glitter's
  // declared workspace dependency; under Bun's isolated linker the consumer
  // has to be selected so its production closure is installed.
  { lane: "site-glitter", site: "glitter", filter: "glitter" },
] as const;

/** Sites deployed from a bundle another lane already built. */
const PREBUILT_SITES = [
  { lane: "site-sjer-red", site: "sjer.red", artifact: "sjer-red-dist" },
  { lane: "site-resume", site: "resume", artifact: "resume-pdf" },
  { lane: "site-wiki", site: "wiki", artifact: "wiki-dist" },
] as const;

function siteCommands(): string[] {
  const lines: string[] = [
    "if ! bun --no-install .buildkite/scripts/selectors/ci-changed.ts sites; then exit 0; fi",
    ". .buildkite/scripts/toolchain.sh",
    "filters=()",
  ];

  for (const { lane, filter } of SOURCE_BUILT_SITES) {
    lines.push(
      `${lane.replaceAll("-", "_")}=false`,
      `if bun --no-install .buildkite/scripts/selectors/ci-changed.ts ${lane}; then`,
      `  ${lane.replaceAll("-", "_")}=true`,
      `  filters+=(--filter ${filter})`,
      "fi",
    );
  }
  for (const { lane } of PREBUILT_SITES) {
    lines.push(
      `${lane.replaceAll("-", "_")}=false`,
      `if bun --no-install .buildkite/scripts/selectors/ci-changed.ts ${lane}; then ${lane.replaceAll("-", "_")}=true; fi`,
    );
  }

  lines.push(
    'if [ "${#filters[@]}" -gt 0 ]; then',
    '  .buildkite/scripts/bun-install.sh --frozen-lockfile "${filters[@]}"',
    "fi",
    ...AWS_ALIASES,
  );

  for (const { lane, site, artifact } of PREBUILT_SITES) {
    const flag = lane.replaceAll("-", "_");
    lines.push(
      `if [ "$${flag}" = "true" ]; then`,
      `  bun --no-install scripts/ci/ci-artifact.ts get ${artifact}`,
      `  bun --no-install scripts/release/deploy-site.ts ${site} --prebuilt`,
      "fi",
    );
  }
  for (const { lane, site } of SOURCE_BUILT_SITES) {
    const flag = lane.replaceAll("-", "_");
    lines.push(
      `if [ "$${flag}" = "true" ]; then bun --no-install scripts/release/deploy-site.ts ${site}; fi`,
    );
  }

  return lines;
}

export function siteSteps(images: CiImages): CiStep[] {
  return [
    {
      key: "sites",
      label: "deploy sites",
      image: images.base,
      commands: siteCommands(),
      dependsOn: [
        "verify",
        "playwright-e2e",
        "resume-build",
        "tofu-apply-seaweedfs",
      ],
      timeoutMinutes: 30,
      resources: VERIFY_TIER,
      defaultBranchOnly: true,
      concurrency: SITE_DEPLOY_GROUP,
      secrets: [GITHUB_DOWNLOAD, ...DEPLOY_KEYS],
    },
    {
      key: "publish",
      label: "publish packages",
      image: images.base,
      commands: [
        "npm_changed=true",
        "cooklang_changed=true",
        "if ! bun --no-install .buildkite/scripts/selectors/ci-changed.ts npm; then npm_changed=false; fi",
        "if ! bun --no-install .buildkite/scripts/selectors/ci-changed.ts cooklang; then cooklang_changed=false; fi",
        'if [ "$npm_changed" != "true" ] && [ "$cooklang_changed" != "true" ]; then exit 0; fi',
        ". .buildkite/scripts/toolchain.sh",
        "filters=()",
        'if [ "$npm_changed" = "true" ]; then',
        "  filters+=(--filter astro-opengraph-images --filter webring --filter '@shepherdjerred/helm-types' --filter '@shepherdjerred/home-assistant')",
        "fi",
        'if [ "$cooklang_changed" = "true" ]; then filters+=(--filter cooklang-for-obsidian); fi',
        '.buildkite/scripts/bun-install.sh --frozen-lockfile "${filters[@]}"',
        'if [ "$npm_changed" = "true" ]; then',
        "  bun --no-install run --cwd packages/astro-opengraph-images publish:npm",
        "  bun --no-install run --cwd packages/webring publish:npm",
        "  bun --no-install run --cwd packages/homelab/src/helm-types publish:npm",
        // Home Assistant cannot publish `latest` before its first release tag
        // exists. Exit status 2 from ls-remote means "no matching ref", which
        // is the expected pre-release state; anything else is a real failure
        // and must not be mistaken for it.
        "  home_assistant_release_state=published",
        "  set +e",
        "  git ls-remote --exit-code --refs origin 'refs/tags/home-assistant-v*'",
        "  home_assistant_lookup_status=$?",
        "  set -e",
        '  if [ "$home_assistant_lookup_status" -eq 2 ]; then',
        "    home_assistant_release_state=pending",
        '    echo "Home Assistant has no release tag; deferring latest publish until its initial release is merged"',
        '  elif [ "$home_assistant_lookup_status" -ne 0 ]; then',
        '    echo "failed to inspect Home Assistant release tags (status $home_assistant_lookup_status)" >&2',
        '    exit "$home_assistant_lookup_status"',
        "  fi",
        '  if [ "$home_assistant_release_state" = "published" ]; then',
        "    bun --no-install run --cwd packages/home-assistant publish:npm",
        "  fi",
        "fi",
        'if [ "$cooklang_changed" = "true" ]; then',
        "  bun --no-install run --cwd packages/cooklang-for-obsidian publish:npm",
        "fi",
      ],
      dependsOn: ["verify", "release-please"],
      timeoutMinutes: 60,
      resources: VERIFY_TIER,
      defaultBranchOnly: true,
      concurrency: { limit: 1, group: "package-publish" },
      secrets: [
        GITHUB_DOWNLOAD,
        grant("ci-npm-credentials", "NPM_TOKEN"),
        grant("ci-github-credentials", "GITHUB_APP_ID"),
        grant("ci-github-credentials", "GITHUB_APP_INSTALLATION_ID"),
        grant("ci-github-credentials", "GITHUB_APP_PRIVATE_KEY"),
      ],
    },
  ];
}
