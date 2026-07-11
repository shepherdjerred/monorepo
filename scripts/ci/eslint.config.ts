import { recommended, type TSESLint } from "@shepherdjerred/eslint-config";

const config: TSESLint.FlatConfig.ConfigArray = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    // eslint.config.ts is intentionally excluded from tsconfig.json's
    // type-project (which only covers src/ + the .dagger deps import), so the
    // type-aware parser needs an explicit default-project allowance for it.
    projectService: { allowDefaultProject: ["eslint.config.ts"] },
  }),
  {
    rules: {
      // Pipeline generator prints its status to stdout.
      "no-console": "off",
      // Deliberate cross-boundary imports (e.g. .dagger/src/deps.ts is the
      // shared WORKSPACE_DEPS source of truth); no alias infrastructure here.
      // `import/no-relative-packages` flags the same intentional import as
      // `no-parent-imports`: the generator reads WORKSPACE_DEPS straight from
      // the Dagger module via `../../../../.dagger/src/deps.ts`. There is no
      // package-alias/self-reference resolvable in a scoped worktree checkout,
      // so the relative path is the source of truth here.
      "custom-rules/no-parent-imports": "off",
      "import/no-relative-packages": "off",
      // These pipeline strings are not secrets: OpenTelemetry resource
      // attributes that embed Buildkite env-var *references* (e.g.
      // `buildkite.branch=$BUILDKITE_BRANCH`) and the intentionally-public
      // `beta-placeholder-*` analytics IDs that keep beta traffic out of prod
      // Pinterest/Reddit conversion data. High Shannon entropy, zero secrecy.
      "no-secrets/no-secrets": [
        "error",
        {
          tolerance: 4.5,
          ignoreContent: [
            "vaults/[a-z0-9]+/items/[a-z0-9-]+",
            String.raw`buildkite\.[a-z.]+=\$BUILDKITE_`,
            "beta-placeholder-",
          ],
        },
      ],
    },
  },
  // Grandfathered pre-existing giants — new modules are held to the normal
  // 500-line cap. Shrink these opportunistically, never grow them.
  {
    files: ["src/change-detection.ts"],
    rules: { "max-lines": ["error", { max: 1200, skipComments: true }] },
  },
  {
    files: ["src/wait-for-greptile.ts", "src/catalog.ts"],
    rules: { "max-lines": ["error", { max: 900, skipComments: true }] },
  },
  // Grandfathered structural complexity in the pipeline generator's core
  // decision functions. `buildPipeline` (complexity ~72) and `detectChanges`
  // (~27, depth 5) are large branch-per-package/flag dispatchers whose logic is
  // covered by the 300+ tests in src/__tests__; splitting them to hit the
  // default caps risks the pipeline output for no behavioural gain.
  // `getLastSuccessfulCommit` (~24) is a single Buildkite-pagination state
  // machine. Reduce these opportunistically alongside real feature work, never
  // grow them; new functions in these files are held to the normal caps.
  {
    files: ["src/pipeline-builder.ts"],
    rules: { complexity: ["error", { max: 75 }] },
  },
  {
    files: ["src/change-detection.ts"],
    rules: {
      complexity: ["error", { max: 27 }],
      "max-depth": ["error", { max: 5 }],
    },
  },
  // Test suites are organised as one top-level `describe` arrow per module;
  // the max-lines-per-function cap is meant for production functions, not the
  // container callback that holds every `it` in a file. Cap generously so a
  // large but flat test file passes without artificially splitting describes.
  {
    files: ["src/__tests__/**/*"],
    rules: { "max-lines-per-function": ["error", { max: 1300 }] },
  },
];
export default config;
