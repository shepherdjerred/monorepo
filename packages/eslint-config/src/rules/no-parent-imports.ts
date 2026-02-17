/**
 * ESLint rule: no-parent-imports
 *
 * Disallows relative imports that navigate to parent directories using ../ syntax.
 * This rule checks the literal import string, not the resolved path.
 *
 * Options:
 * - packagePrefix: The package scope prefix to use for auto-fix (default: "@shepherdjerred")
 *
 * Example with options:
 * "custom-rules/no-parent-imports": ["error", { "packagePrefix": "@myorg" }]
 */

import { dirname, resolve } from "node:path";
import type { TSESLint } from "@typescript-eslint/utils";

type Options = [{ packagePrefix?: string }?];
type MessageIds = "noParentImports";

export const noParentImports: TSESLint.RuleModule<MessageIds, Options> = {
  meta: {
    type: "problem",
    fixable: "code",
    docs: {
      description:
        "Disallow relative imports that navigate to parent directories",
    },
    messages: {
      noParentImports:
        "Relative parent imports are not allowed. Use package imports (e.g., '@scope/package/...') instead of relative paths (e.g., '../...').",
    },
    schema: [
      {
        type: "object",
        properties: {
          packagePrefix: {
            type: "string",
            description: "The package scope prefix to use for auto-fix",
          },
        },
        additionalProperties: false,
      },
    ],
  },
  defaultOptions: [{ packagePrefix: "@shepherdjerred" }],
  create(context) {
    const options = context.options[0] ?? {};
    const packagePrefix = options.packagePrefix ?? "@shepherdjerred";

    return {
      ImportDeclaration(node) {
        const importPath = node.source.value;

        // Check if the import path contains ../ (parent directory navigation)
        if (typeof importPath === "string" && importPath.includes("../")) {
          const currentFilePath = context.filename;

          context.report({
            node: node.source,
            messageId: "noParentImports",
            fix(fixer) {
              // Resolve the absolute path of the imported file
              const currentDir = dirname(currentFilePath);
              const resolvedImportPath = resolve(currentDir, importPath);

              // Determine which package the resolved import belongs to
              // Match: /packages/{packageName}/src/{path} or /packages/{packageName}/{path}
              const packageRegex = /\/packages\/([^/]+)\/(?:src\/)?(.+)$/;
              const packageMatch = packageRegex.exec(resolvedImportPath);
              if (!packageMatch) {
                // Can't determine package, skip auto-fix
                return null;
              }

              const packageName = packageMatch[1];
              const packageRelativePath = packageMatch[2];

              if (!packageName || !packageRelativePath) {
                return null;
              }

              // Construct the package import path
              const fixedImportPath = `${packagePrefix}/${packageName}/${packageRelativePath}`;

              // Replace the import path, preserving quotes
              return fixer.replaceText(node.source, `"${fixedImportPath}"`);
            },
          });
        }
      },
    };
  },
};
