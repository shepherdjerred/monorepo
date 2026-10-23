// Changed-path inputs for the static-site lanes, and the workspace and
// deploy paths other lanes share. Split from migration-core.ts, as
// tofu-lane-paths.ts is.
export const workspacePaths = [
  "bun.lock",
  "bunfig.toml",
  "package.json",
  "patches",
  "turbo.json",
] as const;

export const deployScripts = [
  "scripts/release/deploy-site.ts",
  "scripts/lib/sites/build.ts",
  "scripts/lib/s3-static-site.ts",
  "scripts/lib/run.ts",
] as const;

export const sitePaths = {
  "site-statically-typed": [
    ...workspacePaths,
    "packages/statically-typed",
    "packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts",
    "packages/homelab/src/tofu/cloudflare/statically-typed-com.tf",
    "packages/homelab/src/tofu/seaweedfs/buckets.tf",
    "packages/scout-for-lol/packages/design-system/assets/fonts/BerkeleyMono/BerkeleyMono-Regular.woff2",
    ...deployScripts,
  ],
  "site-sjer-red": [
    ...workspacePaths,
    "packages/sjer.red",
    "packages/astro-opengraph-images",
    "packages/webring",
    "packages/text",
    // Registry corrections must rebuild every static tracker consumer.
    "config/analytics-sites.json",
    ...deployScripts,
  ],
  "site-resume": [
    "packages/resume",
    // Registry corrections must rebuild every static tracker consumer.
    "config/analytics-sites.json",
    ...deployScripts,
  ],
  "site-webring": [
    ...workspacePaths,
    "packages/webring",
    // Registry corrections must rebuild every static tracker consumer.
    "config/analytics-sites.json",
    ...deployScripts,
  ],
  "site-cooklang": [
    ...workspacePaths,
    "packages/cooklang-rich-preview",
    ...deployScripts,
  ],
  "site-stocks": [
    ...workspacePaths,
    "packages/stocks-sjer-red",
    ...deployScripts,
  ],
  "site-landing-pages": [
    ...workspacePaths,
    "packages/landing-pages",
    // The Storm page reads or checks these at build time.
    "packages/storm-forum/config/forum.json",
    "packages/the-storm/server/Dockerfile",
    "packages/ts-mc-docs/astro.config.ts",
    ...deployScripts,
  ],
  "site-cross-compilers": [
    ...workspacePaths,
    "packages/cross-compilers-site",
    ...deployScripts,
  ],
  "site-wiki": [...workspacePaths, "packages/docs/wiki", ...deployScripts],
  "site-better-skill-capped": [
    ...workspacePaths,
    "packages/better-skill-capped",
    // Registry corrections must rebuild every static tracker consumer.
    "config/analytics-sites.json",
    ...deployScripts,
  ],
  "site-glitter": [
    ...workspacePaths,
    "packages/glitter",
    "packages/glitter-context",
    ...deployScripts,
  ],
  "site-glitter-boys": [
    ...workspacePaths,
    "packages/glitter-boys",
    // The site consumes only the native launcher's reviewed publication metadata.
    "packages/glitter-boys-launcher/scripts/public-release.ts",
    "packages/glitter-boys-launcher/scripts/release-manifest.ts",
    "packages/glitter-boys-launcher/published-release.json",
    "packages/glitter-boys-launcher/package.json",
    // The build runs the shared built-link checker, and the main verify step
    // excludes this site, so checker changes must rebuild it here.
    "scripts/checks/check-built-internal-links.ts",
    ...deployScripts,
  ],
  "site-ts-mc-docs": [
    ...workspacePaths,
    "packages/ts-mc-docs",
    "packages/storm-theme",
    // Registry corrections must rebuild every static tracker consumer.
    "config/analytics-sites.json",
    ...deployScripts,
  ],
  // The Storybook catalogs. Scoped to the two packages that build them rather
  // than all of `packages/scout-for-lol`, so a backend or bot change does not
  // redeploy a component catalog neither of them appears in.
  "site-scout-design-system": [
    ...workspacePaths,
    "packages/scout-for-lol/packages/design-system",
    "packages/scout-for-lol/packages/app",
    // The full runtime workspace-dependency closure of app + design-system,
    // so a change several hops away from the catalog packages still redeploys
    // it: data -> domain, charts import @scout-for-lol/report, and every
    // story loads @shepherdjerred/loaded through withAppProviders.
    // @scout-for-lol/backend is deliberately excluded — app imports only its
    // tRPC router *type*, which is erased at build time.
    "packages/scout-for-lol/packages/data",
    "packages/scout-for-lol/packages/domain",
    "packages/scout-for-lol/packages/report",
    "packages/loaded",
    "packages/text",
    "packages/scout-for-lol/scripts/build-storybook-site.ts",
    "packages/scout-for-lol/package.json",
    ...deployScripts,
  ],
  "site-scout": [
    ...workspacePaths,
    "packages/scout-for-lol",
    "packages/astro-opengraph-images",
    "packages/llm-models",
    "packages/text",
    "packages/glitter-context",
    // Registry corrections must rebuild Scout with the corrected site ID.
    "config/analytics-sites.json",
    "scripts/package.json",
    "scripts/release/scout-site-release.ts",
    "scripts/lib/run.ts",
    "scripts/lib/scout/scout-release-entrypoints.ts",
    "scripts/lib/s3-static-site.ts",
    "scripts/lib/scout/scout-release-state.ts",
    "scripts/lib/scout/scout-archive.ts",
    "docker-bake.hcl",
    ".dockerignore",
  ],
} as const;
