/**
 * Import/export linting configuration
 */
import importPlugin from "eslint-plugin-import";
import type { TSESLint } from "@typescript-eslint/utils";

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
        "typescript-bun": {
          alwaysTryTypes: true,
          project: tsconfigPaths,
        },
        node: {
          extensions: [".js", ".jsx", ".ts", ".tsx"],
        },
      }
    : {
        typescript: {
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
