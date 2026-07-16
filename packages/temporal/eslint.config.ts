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
    // knip (dead code/exports) + jscpd (duplication), both at warn.
    customRules: { analysisRules: true },
  }),
];
export default config;
