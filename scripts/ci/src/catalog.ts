/**
 * Central registry of all build targets, deploy sites, Helm charts,
 * and deployment mappings used by the pipeline generator.
 *
 * Ported from the old Python catalog (ci.lib.catalog).
 */

// ---------------------------------------------------------------------------
// Container image push targets
// ---------------------------------------------------------------------------

export interface ImageTarget {
  name: string;
  versionKey: string;
  /** Workspace package name, if different from name (for change detection). */
  package?: string;
  /** Workspace packages needed for the image build (besides the main pkg). */
  neededPackages?: string[];
  /** Custom Dagger build function name (kebab-case). Defaults to "build-image". */
  buildFn?: string;
  /** Custom Dagger push function name (kebab-case). Defaults to "push-image". */
  pushFn?: string;
}

export const IMAGE_PUSH_TARGETS: ImageTarget[] = [
  { name: "birmel", versionKey: "shepherdjerred/birmel" },
  { name: "tasknotes-server", versionKey: "shepherdjerred/tasknotes-server" },
  {
    name: "scout-for-lol",
    versionKey: "shepherdjerred/scout-for-lol",
    buildFn: "build-scout-image",
    pushFn: "push-scout-image",
  },
  {
    name: "discord-plays-pokemon",
    versionKey: "shepherdjerred/discord-plays-pokemon",
    buildFn: "build-discord-plays-pokemon-image",
    pushFn: "push-discord-plays-pokemon-image",
  },
  {
    name: "discord-plays-mario-kart",
    versionKey: "shepherdjerred/discord-plays-mario-kart",
    buildFn: "build-discord-plays-mario-kart-image",
    pushFn: "push-discord-plays-mario-kart-image",
  },
  {
    name: "starlight-karma-bot",
    versionKey: "shepherdjerred/starlight-karma-bot",
  },
  { name: "streambot", versionKey: "shepherdjerred/streambot" },
  {
    name: "temporal-worker",
    package: "temporal",
    versionKey: "shepherdjerred/temporal-worker",
    buildFn: "build-temporal-worker-image",
    pushFn: "push-temporal-worker-image",
  },
  {
    name: "trmnl-dashboard",
    versionKey: "shepherdjerred/trmnl-dashboard",
    buildFn: "build-trmnl-dashboard-image",
    pushFn: "push-trmnl-dashboard-image",
  },
];

export const INFRA_PUSH_TARGETS: ImageTarget[] = [
  {
    name: "caddy-s3proxy",
    package: "homelab",
    versionKey: "shepherdjerred/caddy-s3proxy",
    buildFn: "build-caddy-s-3-proxy-image",
    pushFn: "push-caddy-s-3-proxy-image",
  },
  {
    name: "obsidian-headless",
    package: "homelab",
    versionKey: "shepherdjerred/obsidian-headless",
    buildFn: "build-obsidian-headless-image",
    pushFn: "push-obsidian-headless-image",
  },
  {
    name: "mcp-gateway",
    package: "homelab",
    versionKey: "shepherdjerred/mcp-gateway",
    buildFn: "build-mcp-gateway-image",
    pushFn: "push-mcp-gateway-image",
  },
  {
    name: "redlib",
    package: "homelab",
    versionKey: "shepherdjerred/redlib",
    buildFn: "build-redlib-image",
    pushFn: "push-redlib-image",
  },
];

// ---------------------------------------------------------------------------
// npm packages
// ---------------------------------------------------------------------------

export interface NpmPackage {
  name: string;
  dir: string;
}

export const NPM_PACKAGES: NpmPackage[] = [
  { name: "astro-opengraph-images", dir: "packages/astro-opengraph-images" },
  { name: "webring", dir: "packages/webring" },
  {
    name: "@shepherdjerred/helm-types",
    dir: "packages/homelab/src/helm-types",
  },
];

// ---------------------------------------------------------------------------
// Static site deploys
// ---------------------------------------------------------------------------

interface DeploySiteBase {
  bucket: string;
  name: string;
  url: string;
  buildDir: string;
  buildCmd: string;
  distDir: string;
  needsPlaywright?: boolean;
  workspaceDeps?: string;
  /**
   * Bucket-key prefixes (relative to `distDir`, trailing slash) holding
   * content-hashed/fingerprinted assets. The deploy syncs these with a 1-year
   * `immutable` Cache-Control and never `--delete`s them (a SeaweedFS lifecycle
   * rule prunes old hashes by age); everything else is synced `no-cache` +
   * `--delete`. Defaults to `["_astro/"]` (Astro's hashed output dir). Set `[]`
   * for sites with no fingerprinted assets, or a bundler-specific dir (Vite's
   * `assets/`, the scout SPA's `app/assets/`).
   */
  immutablePrefixes?: string[];
}

type DeploySiteBuildEnv =
  | {
      buildEnvVars?: string[];
      buildEnvPlaceholders?: never;
    }
  | {
      buildEnvVars?: never;
      buildEnvPlaceholders?: Readonly<Record<string, string>>;
    };

export type DeploySite = DeploySiteBase & DeploySiteBuildEnv;

export const DEPLOY_SITES: DeploySite[] = [
  {
    bucket: "sjer-red",
    name: "sjer.red",
    url: "https://sjer.red",
    buildDir: "packages/sjer.red",
    buildCmd: "bun run astro build",
    distDir: "packages/sjer.red/dist",
    needsPlaywright: true,
    workspaceDeps: "astro-opengraph-images,webring",
  },
  {
    bucket: "resume",
    name: "resume",
    url: "https://resume.sjer.red",
    buildDir: "packages/resume",
    buildCmd: "true", // pre-built by latexBuild Dagger function; deploy syncs existing files
    distDir: "packages/resume",
  },
  {
    bucket: "webring",
    name: "webring",
    url: "https://webring.sjer.red",
    buildDir: "packages/webring",
    buildCmd: "bun run typedoc",
    distDir: "packages/webring/docs",
  },
  {
    bucket: "cook",
    name: "cooklang-rich-preview",
    url: "https://cook.sjer.red",
    buildDir: "packages/cooklang-rich-preview",
    buildCmd: "bun run astro build",
    distDir: "packages/cooklang-rich-preview/dist",
  },
  {
    bucket: "stocks-sjer-red",
    name: "stocks-sjer-red",
    url: "https://stocks.sjer.red",
    buildDir: "packages/stocks-sjer-red",
    buildCmd: "bun run astro build",
    distDir: "packages/stocks-sjer-red/dist",
  },
  {
    bucket: "scout-frontend",
    name: "scout-for-lol frontend + app (prod)",
    url: "https://scout-for-lol.com",
    buildDir: "packages/scout-for-lol",
    buildCmd: "bun run scripts/build-bucket.ts",
    distDir: "packages/scout-for-lol/packages/frontend/dist",
    buildEnvVars: ["PUBLIC_PINTEREST_TAG_ID", "PUBLIC_REDDIT_PIXEL_ID"],
    workspaceDeps: "packages/frontend,packages/app",
    // Astro marketing (`_astro/`) + the Vite SPA bundle (`app/assets/`) are
    // content-hashed → immutable. The SPA shell `app/index.html` is in pass 2
    // (no-cache) so deploys take effect.
    immutablePrefixes: ["_astro/", "app/assets/"],
  },
  {
    bucket: "scout-frontend-beta",
    name: "scout-for-lol frontend + app (beta)",
    url: "https://beta.scout-for-lol.com",
    buildDir: "packages/scout-for-lol",
    buildCmd: "bun run scripts/build-bucket.ts",
    distDir: "packages/scout-for-lol/packages/frontend/dist",
    // Analytics pixels intentionally omitted for beta — beta traffic must
    // not inflate prod Pinterest/Reddit conversion data.
    buildEnvPlaceholders: {
      PUBLIC_PINTEREST_TAG_ID: "beta-placeholder-pinterest-tag-id",
      PUBLIC_REDDIT_PIXEL_ID: "beta-placeholder-reddit-pixel-id",
    },
    workspaceDeps: "packages/frontend,packages/app",
    // Astro marketing (`_astro/`) + the Vite SPA bundle (`app/assets/`) are
    // content-hashed → immutable. The SPA shell `app/index.html` is in pass 2
    // (no-cache) so deploys take effect.
    immutablePrefixes: ["_astro/", "app/assets/"],
  },
  {
    bucket: "better-skill-capped",
    name: "better-skill-capped",
    url: "https://better-skill-capped.com",
    buildDir: "packages/better-skill-capped",
    buildCmd: "bun run build",
    distDir: "packages/better-skill-capped/dist",
    // Vite SPA — content-hashed bundles live under `assets/`, not `_astro/`.
    immutablePrefixes: ["assets/"],
  },
  {
    bucket: "glitter-boys-ppl",
    name: "glitter",
    url: "https://ppl.glitter-boys.com",
    buildDir: "packages/glitter",
    buildCmd: "true",
    distDir: "packages/glitter/public",
  },
];

/** Derived from NPM_PACKAGES — workspace packages whose changes should trigger npm publishes. */
export const PACKAGES_WITH_NPM: Set<string> = new Set(
  NPM_PACKAGES.map(
    (pkg) => pkg.dir.replace("packages/", "").split("/")[0] ?? pkg.name,
  ),
);

/**
 * Top-level NPM packages that should get a per-package build step.
 * Excludes nested packages (e.g. helm-types under homelab) where the
 * workspace root doesn't have its own build script.
 */
export const NPM_BUILD_PACKAGES: Set<string> = new Set(
  NPM_PACKAGES.filter((pkg) => !pkg.dir.includes("/src/")).map((pkg) =>
    pkg.dir.replace("packages/", ""),
  ),
);

/** Maps workspace package name to the NpmPackage names it triggers. */
export const PACKAGE_TO_NPM: Record<string, string[]> = {};
for (const pkg of NPM_PACKAGES) {
  const ws = pkg.dir.replace("packages/", "").split("/")[0] ?? pkg.name;
  (PACKAGE_TO_NPM[ws] ??= []).push(pkg.name);
}

// ---------------------------------------------------------------------------
// OpenTofu stacks
// ---------------------------------------------------------------------------

export const TOFU_STACKS = [
  "cloudflare",
  "github",
  "seaweedfs",
  "tailscale",
  "buildkite",
] as const;

export const TOFU_STACK_LABELS: Record<string, string> = {
  cloudflare: "Cloudflare DNS",
  github: "GitHub Config",
  seaweedfs: "SeaweedFS Config",
  tailscale: "Tailscale ACLs",
  buildkite: "Buildkite Config",
};

// ---------------------------------------------------------------------------
// Helm charts (output by cdk8s synth)
// ---------------------------------------------------------------------------

export const HELM_CHARTS: string[] = [
  "ddns",
  "apps",
  "scout-beta",
  "scout-prod",
  "starlight-karma-bot-beta",
  "starlight-karma-bot-prod",
  "redlib",
  "plausible",
  "birmel",
  "cloudflare-tunnel",
  "media",
  "home",
  "postal",
  "syncthing",
  "golink",
  "freshrss",
  "pinchtab",
  "pokemon",
  "mario-kart",
  "gickup",
  "grafana-db",
  "mcp-gateway",
  "s3-static-sites",
  "kyverno-policies",
  "bugsink",
  "tasknotes",
  "temporal",
  "trmnl-dashboard",
];

// ---------------------------------------------------------------------------
// Package-to-site mapping (for change detection)
// ---------------------------------------------------------------------------

/**
 * Maps a workspace package name to the deploy buckets its changes should trigger.
 *
 * Most packages fan out to a single bucket. `scout-for-lol` fans out to both
 * prod and beta buckets because the merged Astro + SPA build is deployed to
 * both stages on every main merge.
 */
export const PACKAGE_TO_SITE: Record<string, string[]> = {
  "sjer.red": ["sjer-red"],
  resume: ["resume"],
  webring: ["webring"],
  "cooklang-rich-preview": ["cook"],
  "scout-for-lol": ["scout-frontend", "scout-frontend-beta"],
  "stocks-sjer-red": ["stocks-sjer-red"],
  "better-skill-capped": ["better-skill-capped"],
  glitter: ["glitter-boys-ppl"],
};

// ---------------------------------------------------------------------------
// Packages that have container image push targets
// ---------------------------------------------------------------------------

/** Derived from IMAGE_PUSH_TARGETS — packages whose changes should trigger image builds. */
export const PACKAGES_WITH_IMAGES: Set<string> = new Set(
  IMAGE_PUSH_TARGETS.map((img) => img.package ?? img.name),
);

// ---------------------------------------------------------------------------
// All packages (used when buildAll = true)
// ---------------------------------------------------------------------------

export const ALL_PACKAGES: string[] = [
  "anki",
  "astro-opengraph-images",
  "better-skill-capped",
  "birmel",
  "cooklang-for-obsidian",
  "cooklang-rich-preview",
  "discord-plays-pokemon",
  "discord-plays-mario-kart",
  "discord-stream-lifecycle",
  "discord-video-stream",
  "docs",
  "dotfiles",
  "eslint-config",
  "fonts",
  "glitter",
  "home-assistant",
  "homelab",
  "leetcode",
  "llm-models",
  "llm-observability",
  "monarch",
  "resume",
  "scout-for-lol",
  "sjer.red",
  "starlight-karma-bot",
  "stocks-sjer-red",
  "streambot",
  "tasknotes-server",
  "tasknotes-types",
  "temporal",
  "tasks-for-obsidian",
  "terraform-provider-asuswrt",
  "toolkit",
  "trmnl-dashboard",
  "webring",
];

// ---------------------------------------------------------------------------
// Resource tiers for per-package build steps
// ---------------------------------------------------------------------------

type ResourceTier = { cpu: string; memory: string };

// BK pods are thin dagger CLI wrappers — all compute happens in the remote
// Dagger engine. Keep requests minimal so more jobs fit within Kueue quota.
const HEAVY: ResourceTier = { cpu: "250m", memory: "512Mi" };
const MEDIUM: ResourceTier = { cpu: "150m", memory: "384Mi" };
const LIGHT: ResourceTier = { cpu: "100m", memory: "256Mi" };

export const PACKAGE_RESOURCES: Record<string, ResourceTier> = {
  homelab: HEAVY,
  birmel: MEDIUM,
  "scout-for-lol": MEDIUM,
  "discord-plays-pokemon": MEDIUM,
  "discord-plays-mario-kart": MEDIUM,
  // Vendored fork; its `test` loads node-av's native ffmpeg, so give it headroom.
  "discord-video-stream": MEDIUM,
  "starlight-karma-bot": MEDIUM,
  streambot: MEDIUM,
  "tasknotes-server": MEDIUM,
  "better-skill-capped": MEDIUM,
  "sjer.red": MEDIUM,
};

export { LIGHT as DEFAULT_RESOURCES };

// ---------------------------------------------------------------------------
// Packages requiring special handling
// ---------------------------------------------------------------------------

/**
 * Packages with no per-package CI steps.
 * They're still in ALL_PACKAGES for change detection (files trigger full-build awareness),
 * but perPackageSteps() skips them.
 */
export const SKIP_PACKAGES: Set<string> = new Set([
  "anki",
  "docs",
  "dotfiles",
  "fonts",
]);

/** Packages that need `bun run generate` before lint/typecheck/test (Prisma). */
export const PRISMA_PACKAGES: Set<string> = new Set([
  "birmel",
  "scout-for-lol",
  "discord-plays-mario-kart",
]);

/**
 * Packages whose runtime image needs the `gh` and `claude` CLIs preinstalled.
 *
 * Birmel's editor sub-agent shells out to both — without them the image
 * runs but the editor agent's tools no-op with a runtime warning.
 */
export const EDITOR_CLI_PACKAGES: Set<string> = new Set(["birmel"]);

/** Packages that are Astro sites. */
export const ASTRO_PACKAGES: Set<string> = new Set([
  "sjer.red",
  "cooklang-rich-preview",
]);

/** Packages that need Playwright browser tests (run in Playwright container, not bunBase). */
export const PLAYWRIGHT_PACKAGES: Set<string> = new Set(["sjer.red"]);

// ---------------------------------------------------------------------------
// Target aliases
// ---------------------------------------------------------------------------

export const ALIASES: Record<string, string[]> = {
  tasks: ["tasknotes"],
  scout: ["scout-beta", "scout-prod"],
  karma: ["starlight-karma-bot-beta", "starlight-karma-bot-prod"],
};

// ---------------------------------------------------------------------------
// Deploy targets (homelab-deploy orchestration)
// ---------------------------------------------------------------------------

export interface DeployTarget {
  name: string;
  images: ImageTarget[];
  charts: string[];
  argoApps: string[];
}

function imageByName(name: string): ImageTarget {
  const img = [...IMAGE_PUSH_TARGETS, ...INFRA_PUSH_TARGETS].find(
    (i) => i.name === name,
  );
  if (!img) {
    throw new Error(`Unknown image name: ${name}`);
  }
  return img;
}

export const DEPLOY_TARGETS: Record<string, DeployTarget> = {
  birmel: {
    name: "birmel",
    images: [imageByName("birmel")],
    charts: ["birmel"],
    argoApps: ["birmel"],
  },
  tasknotes: {
    name: "tasknotes",
    images: [imageByName("tasknotes-server")],
    charts: ["tasknotes"],
    argoApps: ["tasknotes"],
  },
  "scout-beta": {
    name: "scout-beta",
    images: [imageByName("scout-for-lol")],
    charts: ["scout-beta"],
    argoApps: ["scout-beta"],
  },
  "scout-prod": {
    name: "scout-prod",
    images: [],
    charts: ["scout-prod"],
    argoApps: ["scout-prod"],
  },
  "starlight-karma-bot-beta": {
    name: "starlight-karma-bot-beta",
    images: [imageByName("starlight-karma-bot")],
    charts: ["starlight-karma-bot-beta"],
    argoApps: ["starlight-karma-bot-beta"],
  },
  "starlight-karma-bot-prod": {
    name: "starlight-karma-bot-prod",
    images: [],
    charts: ["starlight-karma-bot-prod"],
    argoApps: ["starlight-karma-bot-prod"],
  },
  pokemon: {
    name: "pokemon",
    images: [imageByName("discord-plays-pokemon")],
    charts: ["pokemon"],
    argoApps: ["pokemon"],
  },
  media: {
    name: "media",
    images: [imageByName("streambot")],
    charts: ["media"],
    argoApps: ["media"],
  },
  "mario-kart": {
    name: "mario-kart",
    images: [imageByName("discord-plays-mario-kart")],
    charts: ["mario-kart"],
    argoApps: ["mario-kart"],
  },
  home: {
    name: "home",
    images: [],
    charts: ["home"],
    argoApps: ["home"],
  },
  "s3-static-sites": {
    name: "s3-static-sites",
    images: [imageByName("caddy-s3proxy")],
    charts: ["s3-static-sites"],
    argoApps: ["s3-static-sites"],
  },
};
