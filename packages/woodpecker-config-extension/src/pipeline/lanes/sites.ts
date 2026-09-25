import type { CiImages } from "#src/images.ts";
import type { CiStep, SecretGrant } from "#src/pipeline/model.ts";
import { VERIFY_TIER } from "#src/pipeline/tiers.ts";
import {
  DEPLOY_KEYS,
  HANDOFF_KEYS,
  GITHUB_DOWNLOAD,
  grant,
} from "#src/pipeline/lanes/tofu.ts";

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

/**
 * Site syncs use the deployment identity; the OpenTofu lanes use a separate
 * state identity, and the two are deliberately not interchangeable.
 */
/** deploy-site purges the Cloudflare cache after a successful sync. */
const CLOUDFLARE_PURGE: readonly SecretGrant[] = [
  grant("ci-cloudflare-credentials", "CLOUDFLARE_ACCOUNT_ID"),
  grant("ci-cloudflare-credentials", "CLOUDFLARE_API_TOKEN"),
];

const AWS_ALIASES = [
  'export AWS_ACCESS_KEY_ID="$SEAWEEDFS_SITES_ACCESS_KEY_ID"',
  'export AWS_SECRET_ACCESS_KEY="$SEAWEEDFS_SITES_SECRET_ACCESS_KEY"',
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
    lane: "site-macos-cross",
    site: "macos-cross-site",
    filter: "'@shepherdjerred/macos-cross-site'",
  },
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

/**
 * The Scout Storybook catalogs.
 *
 * Their own entry rather than another SOURCE_BUILT_SITES row: the catalog
 * packages consume source exports from their workspace dependencies, but
 * `@scout-for-lol/data` reaches the llm-models and glitter-context catalogs
 * through dist-only exports. Those two are direct-filtered so the install
 * gives them their build toolchain, then compiled before the site is
 * assembled. `turbo run` would be the obvious way to do that and is exactly
 * wrong here: the lane's install is filtered, so `^build` cannot resolve.
 */
const STORYBOOK_SITE = {
  lane: "site-scout-design-system",
  site: "scout-design-system",
  filters:
    "--filter '@scout-for-lol/design-system' --filter '@scout-for-lol/app' --filter '@shepherdjerred/llm-models' --filter '@shepherdjerred/glitter-context'",
  prebuild: [
    "bun --no-install run --cwd packages/llm-models build",
    "bun --no-install run --cwd packages/glitter-context build",
  ],
} as const;

/** Sites deployed from a bundle another lane already built. */
const PREBUILT_SITES = [
  { lane: "site-sjer-red", site: "sjer.red", artifact: "sjer-red-dist" },
  { lane: "site-resume", site: "resume", artifact: "resume-pdf" },
  { lane: "site-wiki", site: "wiki", artifact: "wiki-dist" },
] as const;

function siteCommands(): string[] {
  const lines: string[] = [
    "if ! bun --no-install ci/scripts/selectors/ci-changed.ts sites; then exit 0; fi",
    ". ci/scripts/toolchain.sh",
    "filters=()",
  ];

  for (const { lane, filter } of SOURCE_BUILT_SITES) {
    lines.push(
      `${lane.replaceAll("-", "_")}=false`,
      `if bun --no-install ci/scripts/selectors/ci-changed.ts ${lane}; then`,
      `  ${lane.replaceAll("-", "_")}=true`,
      `  filters+=(--filter ${filter})`,
      "fi",
    );
  }
  const storybookFlag = STORYBOOK_SITE.lane.replaceAll("-", "_");
  lines.push(
    `${storybookFlag}=false`,
    `if bun --no-install ci/scripts/selectors/ci-changed.ts ${STORYBOOK_SITE.lane}; then`,
    `  ${storybookFlag}=true`,
    `  filters+=(${STORYBOOK_SITE.filters})`,
    "fi",
  );

  for (const { lane } of PREBUILT_SITES) {
    lines.push(
      `${lane.replaceAll("-", "_")}=false`,
      `if bun --no-install ci/scripts/selectors/ci-changed.ts ${lane}; then ${lane.replaceAll("-", "_")}=true; fi`,
    );
  }

  lines.push(
    'if [ "${#filters[@]}" -gt 0 ]; then',
    '  ci/scripts/bun-install.sh --frozen-lockfile "${filters[@]}"',
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
  lines.push(
    `if [ "$${storybookFlag}" = "true" ]; then`,
    ...STORYBOOK_SITE.prebuild.map((command) => `  ${command}`),
    `  bun --no-install scripts/release/deploy-site.ts ${STORYBOOK_SITE.site}`,
    "fi",
  );

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
      secrets: [
        GITHUB_DOWNLOAD,
        ...DEPLOY_KEYS,
        ...HANDOFF_KEYS,
        ...CLOUDFLARE_PURGE,
      ],
    },
    {
      key: "publish",
      label: "publish packages",
      image: images.base,
      commands: [
        "npm_changed=true",
        "cooklang_changed=true",
        "if ! bun --no-install ci/scripts/selectors/ci-changed.ts npm; then npm_changed=false; fi",
        "if ! bun --no-install ci/scripts/selectors/ci-changed.ts cooklang; then cooklang_changed=false; fi",
        'if [ "$npm_changed" != "true" ] && [ "$cooklang_changed" != "true" ]; then exit 0; fi',
        ". ci/scripts/toolchain.sh",
        "filters=()",
        'if [ "$npm_changed" = "true" ]; then',
        "  filters+=(--filter astro-opengraph-images --filter webring --filter '@shepherdjerred/helm-types' --filter '@shepherdjerred/home-assistant')",
        "fi",
        'if [ "$cooklang_changed" = "true" ]; then filters+=(--filter cooklang-for-obsidian); fi',
        'ci/scripts/bun-install.sh --frozen-lockfile "${filters[@]}"',
        'if [ "$npm_changed" = "true" ]; then',
        "  bun --no-install run --cwd packages/astro-opengraph-images publish:npm",
        "  bun --no-install run --cwd packages/webring publish:npm",
        "  bun --no-install run --cwd packages/homelab/src/helm-types publish:npm",
        "  bun --no-install run --cwd packages/home-assistant publish:npm",
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
