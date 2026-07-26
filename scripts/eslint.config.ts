import { recommended } from "@shepherdjerred/eslint-config";

// Annotating with recommended()'s own return type (rather than letting the type
// be inferred) keeps tsc from emitting TS2883 "inferred type ... cannot be named
// without a reference to ... @typescript-eslint/utils" — and referencing it via
// `typeof recommended` binds to the exact copy the config package ships, so the
// nested-vs-root type identities don't diverge.
const config: ReturnType<typeof recommended> = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    // Standalone mini-package (own package.json + bun.lock, outside the
    // workspace); its deps only exist after its own install, so neither the
    // scripts tsconfig nor the project service can type it.
    ignores: ["observability/local-stack/**"],
  }),
  {
    rules: {
      // These are operator CLIs: stdout is the interface.
      "no-console": "off",
      // Standalone script dir with no package import-alias infrastructure;
      // relative parent imports are the only way to reach shared modules.
      "custom-rules/no-parent-imports": "off",
    },
  },
  {
    // CI scripts run dependency-free via `bun --no-install` BEFORE any
    // workspace install (image selection happens pre-toolchain), so Zod
    // cannot exist there — type-guard narrowing is the only available
    // validation. These patterns only match on the repo-root lint pass (see
    // the lint script); the in-workspace `eslint .` run never sees them.
    files: [".buildkite/scripts/**/*.ts"],
    rules: {
      "custom-rules/no-type-guards": "off",
    },
  },
];
export default config;
