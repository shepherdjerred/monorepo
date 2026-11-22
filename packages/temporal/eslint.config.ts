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
  // typescript-eslint 8.72.1 (#12988) builds one Program per tsconfig in
  // single-run mode alongside the project service. For this package that
  // needs a 4-6 GiB heap and overran Node's default 4 GiB heap in CI; without
  // single-run inference the lint fits the default heap as it did on 8.71.
  {
    languageOptions: {
      parserOptions: {
        disallowAutomaticSingleRunInference: true,
      },
    },
  },
];
export default config;
