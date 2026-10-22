import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { VERIFY_TIER } from "#src/pipeline/tiers.ts";
import {
  DELIVERY_ARCHIVE_KEYS,
  HANDOFF_KEYS,
  GITHUB_DOWNLOAD,
  grant,
} from "#src/pipeline/lanes/tofu.ts";

/**
 * Immutable static site archives and package publishing.
 *
 * Both lanes select per-target inside the step rather than at pipeline level,
 * because one lane covers many sites (or two publish groups) and each has its
 * own answer. Selection decides whether the LANE runs; the step decides which
 * targets within it do.
 */

const SITE_ARCHIVE_GROUP = { limit: 1, group: "site-archives" } as const;

/** Sites built from source in this step, with the workspace each needs. */
const SOURCE_BUILT_SITES = [
  {
    lane: "site-statically-typed",
    site: "statically-typed",
    filter: "'@shepherdjerred/statically-typed'",
  },
  { lane: "site-webring", site: "webring", filter: "webring" },
  {
    lane: "site-cooklang",
    site: "cooklang-rich-preview",
    filter: "'@shepherdjerred/cooklang-rich-preview'",
  },
  { lane: "site-stocks", site: "stocks-sjer-red", filter: "stocks-sjer-red" },
  {
    lane: "site-cross-compilers",
    site: "cross-compilers-site",
    filter: "'@shepherdjerred/cross-compilers-site'",
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
  {
    lane: "site-glitter-boys",
    site: "glitter-boys",
    filter: "'@shepherdjerred/glitter-boys'",
  },
  {
    lane: "site-ts-mc-docs",
    site: "ts-mc-docs",
    filter: "'@shepherdjerred/ts-mc-docs'",
  },
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

function siteCommands(catalogV2: boolean): string[] {
  const archiveFlag = " --archive";
  const lines: string[] = [
    ". ci/scripts/toolchain.sh",
    // Prebuilt-only deploys still call ci-artifact from the root scripts.
    "filters=(--filter '@shepherdjerred/root-scripts')",
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
    'ci/scripts/bun-install.sh --frozen-lockfile "${filters[@]}"',
    "mkdir -p .delivery-artifacts",
  );

  for (const { lane, site, artifact } of PREBUILT_SITES) {
    const flag = lane.replaceAll("-", "_");
    lines.push(
      `if [ "$${flag}" = "true" ]; then`,
      `  bun --no-install scripts/ci/ci-artifact.ts get ${artifact}`,
      `  bun --no-install scripts/release/deploy-site.ts ${site} --prebuilt${archiveFlag}`,
      "fi",
    );
  }
  for (const { lane, site } of SOURCE_BUILT_SITES) {
    const flag = lane.replaceAll("-", "_");
    lines.push(
      `if [ "$${flag}" = "true" ]; then bun --no-install scripts/release/deploy-site.ts ${site}${archiveFlag}; fi`,
    );
  }
  lines.push(
    `if [ "$${storybookFlag}" = "true" ]; then`,
    ...STORYBOOK_SITE.prebuild.map((command) => `  ${command}`),
    `  bun --no-install scripts/release/deploy-site.ts ${STORYBOOK_SITE.site}${archiveFlag}`,
    "fi",
  );

  lines.push(
    `bun --no-install scripts/ci/write-site-archive-handoff.ts${catalogV2 ? " --catalog-v2" : ""}`,
  );

  return lines;
}

export function siteSteps(images: CiImages, catalogV2 = false): CiStep[] {
  return [
    {
      key: "sites",
      label: "publish site archives",
      image: images.base,
      commands: siteCommands(catalogV2),
      dependsOn: [
        "verify",
        "playwright-e2e",
        "resume-build",
        "scout-site-archives",
      ],
      timeoutMinutes: 30,
      resources: VERIFY_TIER,
      defaultBranchOnly: true,
      concurrency: SITE_ARCHIVE_GROUP,
      secrets: [GITHUB_DOWNLOAD, ...DELIVERY_ARCHIVE_KEYS, ...HANDOFF_KEYS],
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
        "  bun --no-install run --cwd packages/cooklang-for-obsidian publish:plugin",
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
