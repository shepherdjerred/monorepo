import { recommended } from "@shepherdjerred/eslint-config";

// No explicit `TSESLint.FlatConfig.ConfigArray` annotation: temporal and
// eslint-config can resolve different patch versions of
// `@typescript-eslint/utils` under a per-package
// `bun install --frozen-lockfile`, and the resulting `ConfigArray` types
// are nominally incompatible. Letting TS infer the return shape keeps the
// file portable across both layouts.
const config = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
  }),
  // typescript-eslint (#12988) builds one Program per tsconfig in single-run
  // mode alongside the project service. Avoid retaining both programs here.
  // The lint script caps V8 old space at 6 GiB for cold runs of the full graph.
  {
    languageOptions: {
      parserOptions: {
        disallowAutomaticSingleRunInference: true,
      },
    },
  },
];
export default config;
