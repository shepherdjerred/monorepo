/**
 * ESLint rule: no-parent-imports
 *
 * Disallows relative imports that navigate to parent directories using ../ syntax.
 * This rule checks the literal import string, not the resolved path.
 *
 * ❌ BAD:
 * import { x } from "../model/something";
 * import { y } from "../../utils";
 *
 * ✅ GOOD:
 * import { x } from "./local-file";
 * import { y } from "@shepherdjerred/scout-data/model/something";
 */

// eslint-disable-next-line no-restricted-imports -- ESLint rule needs path utilities for auto-fix
import { dirname, resolve } from "node:path";
import type { TSESLint } from "@typescript-eslint/utils";

export const noParentImports: TSESLint.RuleModule<"noParentImports"> = {
  meta: {
    type: "problem",
    fixable: "code",
    docs: {
      description: "Disallow relative imports that navigate to parent directories",
    },
    messages: {
      noParentImports:
        "Relative parent imports are not allowed. Use package imports (e.g., '@shepherdjerred/scout-data/...') instead of relative paths (e.g., '../...').",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
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
              const fixedImportPath = `@shepherdjerred/scout-${packageName}/${packageRelativePath}`;

              // Replace the import path, preserving quotes
              return fixer.replaceText(node.source, `"${fixedImportPath}"`);
            },
          });
        }
      },
    };
  },
};
