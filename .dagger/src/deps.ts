/**
 * Workspace dependency map: for each package, the list of other packages
 * that must be present in the container for file: deps to resolve.
 *
 * Used by both the Dagger module (to mount deps) and the CI pipeline
 * generator (to produce --dep-names / --dep-dirs flags).
 */
export const WORKSPACE_DEPS: Record<string, string[]> = {
  // Standalone (no workspace deps)
  "eslint-config": [],
  resume: [],

  // eslint-config only
  "astro-opengraph-images": ["eslint-config"],
  webring: ["eslint-config"],
  toolkit: ["eslint-config"],
  "hn-enhancer": ["eslint-config"],
  monarch: ["eslint-config"],
  "cooklang-rich-preview": ["eslint-config"],
  "better-skill-capped": ["eslint-config"],
  birmel: ["eslint-config"],
  "starlight-karma-bot": ["eslint-config"],
  "tasknotes-types": ["eslint-config"],

  // Multi-dep packages
  "tasknotes-server": ["eslint-config", "tasknotes-types"],
  "tasks-for-obsidian": ["eslint-config", "tasknotes-types"],
  "sjer.red": ["eslint-config", "astro-opengraph-images", "webring"],

  // Homelab
  homelab: ["eslint-config"],
  "homelab/src/cdk8s": ["eslint-config", "homelab/src/helm-types"],
  "homelab/src/ha": ["eslint-config"],
  "homelab/src/helm-types": ["eslint-config"],

  // Nested workspace packages (sub-packages are inside parent dir)
  "discord-plays-pokemon": ["eslint-config"],
  "scout-for-lol": ["eslint-config"],
};

/**
 * Packages that must have `bun run build` executed before dependents
 * can use them (they export types/assets via dist/).
 * Order matters: build in this order.
 */
export const BUILD_TIME_DEPS: string[] = [
  "eslint-config",
  "astro-opengraph-images",
  "webring",
  "tasknotes-types",
];
