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

import path from "node:path";
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
              // Extract the current file's package and relative path from filename.
              // Match the LAST /packages/ segment to handle Bazel sandbox paths.
              const packageRegex = /.*\/packages\/([^/]+)\/(?:src\/)?(.+)$/;
              const fileMatch = packageRegex.exec(currentFilePath);
              if (!fileMatch) {
                return null;
              }

              const currentPackage = fileMatch[1];
              const fileRelativePath = fileMatch[2];
              if (
                currentPackage === undefined ||
                fileRelativePath === undefined
              ) {
                return null;
              }

              // Compute the target path relative to the package src/ dir.
              // join the file's dir (relative to package) with the import path,
              // then normalize to remove ../ segments.
              const fileDir = path.dirname(fileRelativePath);
              const targetPath = path.normalize(path.join(fileDir, importPath));

              // If the normalized path still starts with "..", the import
              // escapes the package — skip auto-fix.
              if (targetPath.startsWith("..")) {
                return null;
              }

              const fixedImportPath = `${packagePrefix}/${currentPackage}/${targetPath}`;
              return fixer.replaceText(node.source, `"${fixedImportPath}"`);
            },
          });
        }
      },
    };
  },
};
