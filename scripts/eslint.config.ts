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
    // `.buildkite/scripts` is not a workspace member (no package.json), so
    // Zod is unreachable from any file there under the isolated linker,
    // regardless of install state — a type predicate is the only way to
    // narrow parsed JSON without an `as` cast, which `no-type-assertions`
    // bans outright. Enumerate the files that actually declare one instead
    // of a directory-wide `.buildkite/scripts/**/*.ts` glob, so a future
    // script that doesn't need this escape hatch doesn't inherit it silently
    // — adding a file here is a visible, reviewable diff line.
    files: [
      ".buildkite/scripts/select-image-targets-lockfile.ts",
      ".buildkite/scripts/annotate-image-summary.ts",
      ".buildkite/scripts/ci-lane-coverage.test.ts",
    ],
    rules: {
      "custom-rules/no-type-guards": "off",
    },
  },
];
export default config;
