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
  leetcode: [],
  resume: [],
  // Vendored fork of @dank074/discord-video-stream; standalone (no file: deps of its own).
  "discord-video-stream": [],

  // eslint-config only
  "astro-opengraph-images": ["eslint-config"],
  webring: ["eslint-config"],
  toolkit: ["eslint-config"],
  monarch: ["eslint-config"],
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
  temporal: ["eslint-config", "home-assistant", "toolkit", "llm-observability"],

  // Multi-dep packages
  "tasknotes-server": ["eslint-config", "tasknotes-types"],
  "tasks-for-obsidian": ["eslint-config", "tasknotes-types"],
  "sjer.red": ["eslint-config", "astro-opengraph-images", "webring"],

  // Homelab
  homelab: ["eslint-config"],
  "homelab/src/cdk8s": ["eslint-config", "homelab/src/helm-types"],
  "homelab/src/helm-types": ["eslint-config"],

  // Nested workspace packages (sub-packages are inside parent dir).
  // The nested */packages/backend consume discord-stream-lifecycle via
  // file:../../../discord-stream-lifecycle, which resolves to the dep mounted
  // at /workspace/packages/discord-stream-lifecycle.
  "discord-plays-pokemon": [
    "eslint-config",
    "discord-video-stream",
    "discord-stream-lifecycle",
    "llm-observability",
  ],
  "discord-plays-mario-kart": [
    "eslint-config",
    "discord-video-stream",
    "discord-stream-lifecycle",
  ],
  "scout-for-lol": ["eslint-config", "llm-observability"],
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
  "astro-opengraph-images",
  "webring",
  "tasknotes-types",
  // Emits dist/*.d.ts (declaration-only) so dependents' tsc resolves its types; bun runs its src.
  "discord-video-stream",
];
