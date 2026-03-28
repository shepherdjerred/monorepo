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
}

export const IMAGE_PUSH_TARGETS: ImageTarget[] = [
  { name: "birmel", versionKey: "shepherdjerred/birmel" },
  { name: "tasknotes-server", versionKey: "shepherdjerred/tasknotes-server" },
  { name: "scout-for-lol", versionKey: "shepherdjerred/scout-for-lol/beta" },
  { name: "discord-plays-pokemon", versionKey: "shepherdjerred/discord-plays-pokemon" },
  { name: "starlight-karma-bot", versionKey: "shepherdjerred/starlight-karma-bot/beta" },
  { name: "better-skill-capped-fetcher", package: "better-skill-capped", versionKey: "shepherdjerred/better-skill-capped-fetcher" },
];

export const INFRA_PUSH_TARGETS: ImageTarget[] = [
  { name: "homelab", versionKey: "shepherdjerred/homelab" },
  { name: "dependency-summary", package: "homelab", versionKey: "shepherdjerred/dependency-summary" },
  { name: "dns-audit", package: "homelab", versionKey: "shepherdjerred/dns-audit" },
  { name: "caddy-s3proxy", package: "homelab", versionKey: "shepherdjerred/caddy-s3proxy" },
];

// ---------------------------------------------------------------------------
// npm packages
// ---------------------------------------------------------------------------

export interface NpmPackage {
  name: string;
  dir: string;
}

export const NPM_PACKAGES: NpmPackage[] = [
  { name: "bun-decompile", dir: "packages/bun-decompile" },
  { name: "astro-opengraph-images", dir: "packages/astro-opengraph-images" },
  { name: "webring", dir: "packages/webring" },
  { name: "helm-types", dir: "packages/homelab/src/helm-types" },
];

// ---------------------------------------------------------------------------
// Static site deploys
// ---------------------------------------------------------------------------

export interface DeploySite {
  bucket: string;
  name: string;
  buildDir: string;
  buildCmd: string;
  distDir: string;
  needsPlaywright?: boolean;
  workspaceDeps?: string;
}

export const DEPLOY_SITES: DeploySite[] = [
  {
    bucket: "sjer-red",
    name: "sjer.red",
    buildDir: "packages/sjer.red",
    buildCmd: "bun run astro build",
    distDir: "packages/sjer.red/dist",
    needsPlaywright: true,
    workspaceDeps: "astro-opengraph-images,webring",
  },
  {
    bucket: "clauderon",
    name: "clauderon docs",
    buildDir: "packages/clauderon/docs",
    buildCmd: "bun run astro build",
    distDir: "packages/clauderon/docs/dist",
    workspaceDeps: "astro-opengraph-images",
  },
  {
    bucket: "resume",
    name: "resume",
    buildDir: "packages/resume",
    buildCmd: "",
    distDir: "packages/resume",
  },
  {
    bucket: "webring",
    name: "webring",
    buildDir: "packages/webring",
    buildCmd: "bun run typedoc",
    distDir: "packages/webring/docs",
  },
  {
    bucket: "cook",
    name: "cooklang-rich-preview",
    buildDir: "packages/cooklang-rich-preview",
    buildCmd: "bun run astro build",
    distDir: "packages/cooklang-rich-preview/dist",
  },
];

// ---------------------------------------------------------------------------
// OpenTofu stacks
// ---------------------------------------------------------------------------

export const TOFU_STACKS = ["cloudflare", "github", "seaweedfs"] as const;

export const TOFU_STACK_LABELS: Record<string, string> = {
  cloudflare: "Cloudflare DNS",
  github: "GitHub Config",
  seaweedfs: "SeaweedFS Config",
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
  "better-skill-capped-fetcher",
  "plausible",
  "birmel",
  "cloudflare-tunnel",
  "media",
  "home",
  "postal",
  "syncthing",
  "golink",
  "freshrss",
  "pokemon",
  "gickup",
  "grafana-db",
  "mcp-gateway",
  "s3-static-sites",
  "kyverno-policies",
  "bugsink",
  "dns-audit",
  "tasknotes",
];

// ---------------------------------------------------------------------------
// Package-to-site mapping (for change detection)
// ---------------------------------------------------------------------------

export const PACKAGE_TO_SITE: Record<string, string> = {
  "sjer.red": "sjer-red",
  resume: "resume",
  clauderon: "clauderon",
  webring: "webring",
  "cooklang-rich-preview": "cook",
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
  "bun-decompile",
  "castle-casters",
  "clauderon",
  "cooklang-rich-preview",
  "discord-plays-pokemon",
  "docs",
  "dotfiles",
  "eslint-config",
  "fonts",
  "glance",
  "hn-enhancer",
  "homelab",
  "leetcode",
  "macos-cross-compiler",
  "monarch",
  "resume",
  "scout-for-lol",
  "sjer.red",
  "starlight-karma-bot",
  "tasknotes-server",
  "tasknotes-types",
  "tasks-for-obsidian",
  "terraform-provider-asuswrt",
  "tips",
  "toolkit",
  "webring",
];

// ---------------------------------------------------------------------------
// Resource tiers for per-package build steps
// ---------------------------------------------------------------------------

type ResourceTier = { cpu: string; memory: string };

const HEAVY: ResourceTier = { cpu: "2", memory: "4Gi" };
const MEDIUM: ResourceTier = { cpu: "1", memory: "2Gi" };
const LIGHT: ResourceTier = { cpu: "500m", memory: "1Gi" };

export const PACKAGE_RESOURCES: Record<string, ResourceTier> = {
  clauderon: HEAVY,
  homelab: HEAVY,
  birmel: MEDIUM,
  "scout-for-lol": MEDIUM,
  "discord-plays-pokemon": MEDIUM,
  "starlight-karma-bot": MEDIUM,
  "tasknotes-server": MEDIUM,
  "better-skill-capped": MEDIUM,
  "sjer.red": MEDIUM,
  "castle-casters": MEDIUM,
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
  "leetcode",
  "macos-cross-compiler",
  "glance",
  "tips",
]);

/** Packages that need `bun run generate` before lint/typecheck/test (Prisma). */
export const PRISMA_PACKAGES: Set<string> = new Set([
  "birmel",
  "scout-for-lol",
]);

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
  "better-skill-capped-fetcher": {
    name: "better-skill-capped-fetcher",
    images: [imageByName("better-skill-capped-fetcher")],
    charts: ["better-skill-capped-fetcher"],
    argoApps: ["better-skill-capped-fetcher"],
  },
  home: {
    name: "home",
    images: [imageByName("homelab")],
    charts: ["home"],
    argoApps: ["home"],
  },
  "dns-audit": {
    name: "dns-audit",
    images: [imageByName("dns-audit")],
    charts: ["dns-audit"],
    argoApps: ["dns-audit"],
  },
  "s3-static-sites": {
    name: "s3-static-sites",
    images: [imageByName("caddy-s3proxy")],
    charts: ["s3-static-sites"],
    argoApps: ["s3-static-sites"],
  },
  "dependency-summary": {
    name: "dependency-summary",
    images: [imageByName("dependency-summary")],
    charts: ["apps"],
    argoApps: ["apps"],
  },
};
