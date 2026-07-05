/**
 * Import/export linting configuration
 */
import { createRequire } from "node:module";
import importPlugin from "eslint-plugin-import";
import type { TSESLint } from "@typescript-eslint/utils";

// Resolve resolver packages from THIS package's module context. Under bun's
// isolated linker, eslint-plugin-import cannot load string-named resolvers:
// they are eslint-config's deps, invisible from plugin-import's own store
// subtree (a bare "typescript" key even resolves to the TypeScript compiler,
// producing "invalid interface loaded as resolver"). plugin-import accepts
// absolute paths as resolver keys, which sidesteps its lookup entirely.
const localRequire = createRequire(import.meta.url);
const resolverPath = (name: string): string => localRequire.resolve(name);

export type ImportsConfigOptions = {
  tsconfigPaths?: string[];
  useBunResolver?: boolean;
};

/**
 * Configuration for import/export linting with TypeScript resolver
 */
export function importsConfig(
  options: ImportsConfigOptions = {},
): TSESLint.FlatConfig.ConfigArray {
  const { tsconfigPaths = ["./tsconfig.json"], useBunResolver = true } =
    options;

  const resolverConfig = useBunResolver
    ? {
        [resolverPath("eslint-import-resolver-typescript-bun")]: {
          alwaysTryTypes: true,
          project: tsconfigPaths,
        },
        node: {
          extensions: [".js", ".jsx", ".ts", ".tsx"],
        },
      }
    : {
        [resolverPath("eslint-import-resolver-typescript")]: {
          alwaysTryTypes: true,
          project: tsconfigPaths,
        },
        node: {
          extensions: [".js", ".jsx", ".ts", ".tsx"],
        },
      };

  return [
    {
      files: ["**/*.{ts,tsx}"],
      ...importPlugin.flatConfigs.recommended,
      ...importPlugin.flatConfigs.typescript,
      settings: {
        "import/resolver": resolverConfig,
      },
      rules: {
        // Prevent relative imports between packages in monorepo
        "import/no-relative-packages": "error",
      },
    },
  ] as TSESLint.FlatConfig.ConfigArray;
}
