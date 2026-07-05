/**
 * Workspace dependency map: for each package, the list of other members
 * that must be mounted (full source) in the container so `workspace:*` deps
 * resolve; everything else is present as manifest-only stubs (workspaceMeta).
 * Also drives the `--filter` list for the root workspace install.
 *
 * Used by both the Dagger module (to mount deps) and the CI pipeline
 * generator (to produce --dep-names / --dep-dirs flags).
 */
export const WORKSPACE_DEPS: Record<string, string[]> = {
  // Standalone (no workspace deps)
  "eslint-config": [],
  leetcode: [],
  resume: [],
  // Vendored fork of @dank074/discord-video-stream; standalone (no file: deps of its own).
  "discord-video-stream": [],

  // eslint-config only
  "astro-opengraph-images": ["eslint-config"],
  webring: ["eslint-config"],
  toolkit: ["eslint-config"],
  monarch: ["eslint-config", "llm-models"],
  "cooklang-for-obsidian": ["eslint-config"],
  "cooklang-rich-preview": ["eslint-config"],
  "better-skill-capped": ["eslint-config"],
  birmel: ["eslint-config", "llm-observability"],
  "llm-models": ["eslint-config"],
  "llm-observability": ["eslint-config"],
  "starlight-karma-bot": ["eslint-config"],
  // Shared XState stream lifecycle machine; consumed via file: deps by
  // streambot and the discord-plays-* backends below.
  "discord-stream-lifecycle": ["eslint-config"],
  streambot: [
    "eslint-config",
    "discord-video-stream",
    "discord-stream-lifecycle",
  ],
  "tasknotes-types": ["eslint-config"],
  "home-assistant": ["eslint-config"],
  "trmnl-dashboard": ["eslint-config", "home-assistant"],
  // `toolkit` here is not a file: dep in temporal's package.json — it's
  // mounted so the worker-image build can compile the toolkit CLI into a
  // single static binary at /usr/local/bin/toolkit. Required by the
  // homelab-audit-daily workflow (runbook §5/§6/§9 use `toolkit gf|pd|bugsink`).
  temporal: [
    "eslint-config",
    "home-assistant",
    "toolkit",
    "llm-models",
    "llm-observability",
  ],

  // Multi-dep packages
  "tasknotes-server": ["eslint-config", "tasknotes-types"],
  "tasks-for-obsidian": ["eslint-config", "tasknotes-types"],
  "sjer.red": ["eslint-config", "astro-opengraph-images", "webring"],

  // Homelab
  homelab: [
    // Own members first (workspace install filters [pkg, ...deps]).
    "homelab/src/cdk8s",
    "homelab/src/helm-types",
    "eslint-config",
  ],
  "homelab/src/cdk8s": ["eslint-config", "homelab/src/helm-types"],
  "homelab/src/helm-types": ["eslint-config"],

  // Nested workspace packages (sub-packages are inside parent dir).
  // The nested */packages/backend consume discord-stream-lifecycle via
  // file:../../../discord-stream-lifecycle, which resolves to the dep mounted
  // at /workspace/packages/discord-stream-lifecycle.
  "discord-plays-pokemon": [
    // Own members first: the workspace install filters [pkg, ...deps], so the
    // parent target must list them for member deps to materialize.
    "discord-plays-pokemon/packages/backend",
    "discord-plays-pokemon/packages/common",
    "discord-plays-pokemon/packages/frontend",
    "eslint-config",
    "discord-video-stream",
    "discord-stream-lifecycle",
    "llm-models",
    "llm-observability",
  ],
  "discord-plays-mario-kart": [
    "discord-plays-mario-kart/packages/backend",
    "discord-plays-mario-kart/packages/common",
    "discord-plays-mario-kart/packages/frontend",
    "eslint-config",
    "discord-video-stream",
    "discord-stream-lifecycle",
  ],
  "scout-for-lol": [
    "scout-for-lol/packages/app",
    "scout-for-lol/packages/backend",
    "scout-for-lol/packages/data",
    "scout-for-lol/packages/desktop",
    "scout-for-lol/packages/frontend",
    "scout-for-lol/packages/report",
    "scout-for-lol/packages/ui",
    "eslint-config",
    "llm-models",
    "llm-observability",
    // scout frontend consumes astro-opengraph-images (workspace:*)
    "astro-opengraph-images",
  ],
  "scout-for-lol/packages/data": ["llm-models"],
  "scout-for-lol/packages/frontend": [
    "eslint-config",
    "scout-for-lol/packages/backend",
    "scout-for-lol/packages/data",
    "scout-for-lol/packages/report",
  ],
};

/**
 * Packages that must have `bun run build` executed before dependents
 * can use them (they export types/assets via dist/).
 * Order matters: build in this order.
 */
export const BUILD_TIME_DEPS: string[] = [
  "eslint-config",
  // Built package (browser+node safe): package.json `main`/`types`/`exports`
  // resolve to dist/, so consumers (temporal, monarch, scout, discord-plays-*)
  // can't resolve the module until `bun run build` emits dist/. Must come after
  // eslint-config (its only build-time dep).
  "llm-models",
  "astro-opengraph-images",
  "webring",
  "tasknotes-types",
  // Emits dist/*.d.ts (declaration-only) so dependents' tsc resolves its types; bun runs its src.
  "discord-video-stream",
];
