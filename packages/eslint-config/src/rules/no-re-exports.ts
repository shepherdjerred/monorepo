import { AST_NODE_TYPES, ESLintUtils } from "@typescript-eslint/utils";
import type { TSESTree } from "@typescript-eslint/utils";

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://github.com/shepherdjerred/share/tree/main/packages/eslint-config/src/rules/${name}.ts`,
);

export const noReExports = createRule({
  name: "no-re-exports",
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow re-exporting from other modules. Only allow exports of declarations defined in the same file for better code organization and explicit dependencies.",
    },
    messages: {
      noExportAll:
        "Re-exports (export * from) are not allowed. Only export declarations from the same file. This ensures explicit exports and prevents accidental API surface expansion.",
      noExportNamed:
        "Re-exports (export { ... } from) are not allowed. Only export declarations from the same file. Import and re-declare if you need to expose external symbols.",
      noReExportImported:
        "Re-exports of imported identifiers (export type { ... }) are not allowed. Only export declarations from the same file. Import and re-declare if you need to expose external symbols.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    // Track imported identifiers (including type imports)
    const importedIdentifiers = new Set<string>();
    // Track locally declared identifiers (functions, classes, types, interfaces, etc.)
    const localDeclarations = new Set<string>();

    return {
      // Track imports to detect re-exports of imported identifiers
      ImportDeclaration(node: TSESTree.ImportDeclaration) {
        for (const specifier of node.specifiers) {
          if (specifier.type === AST_NODE_TYPES.ImportSpecifier) {
            importedIdentifiers.add(specifier.local.name);
          } else if (specifier.type === AST_NODE_TYPES.ImportDefaultSpecifier) {
            importedIdentifiers.add(specifier.local.name);
          } else {
            // ImportNamespaceSpecifier
            importedIdentifiers.add(specifier.local.name);
          }
        }
      },

      // Track local declarations to avoid false positives
      // (if something is both imported and locally declared, exporting it is fine)
      FunctionDeclaration(node: TSESTree.FunctionDeclaration) {
        if (node.id) {
          localDeclarations.add(node.id.name);
        }
      },
      ClassDeclaration(node: TSESTree.ClassDeclaration) {
        if (node.id) {
          localDeclarations.add(node.id.name);
        }
      },
      TSInterfaceDeclaration(node: TSESTree.TSInterfaceDeclaration) {
        localDeclarations.add(node.id.name);
      },
      TSTypeAliasDeclaration(node: TSESTree.TSTypeAliasDeclaration) {
        localDeclarations.add(node.id.name);
      },
      VariableDeclarator(node: TSESTree.VariableDeclarator) {
        if (node.id.type === AST_NODE_TYPES.Identifier) {
          localDeclarations.add(node.id.name);
        }
      },

      // Check for export * from "module"
      ExportAllDeclaration(node) {
        context.report({
          node,
          messageId: "noExportAll",
        });
      },

      // Check for export { foo } from "module" or export type { imported } (without from)
      ExportNamedDeclaration(node: TSESTree.ExportNamedDeclaration) {
        // Flag if it has a source (i.e., it's a re-export with "from")
        if (node.source) {
          context.report({
            node,
            messageId: "noExportNamed",
          });
          return;
        }

        // If there's a declaration (export function foo() {}, export class Bar {}, etc.), it's fine
        if (node.declaration) {
          return;
        }

        // Check if any exported identifiers are imported but not locally declared
        for (const specifier of node.specifiers) {
          // ExportSpecifier is the only type for specifiers in ExportNamedDeclaration without source
          const exportSpecifier = specifier as TSESTree.ExportSpecifier;

          // ExportSpecifier.local is always an Identifier (type narrowing)
          if (exportSpecifier.local.type !== "Identifier") {
            continue;
          }
          const localName = exportSpecifier.local.name;

          // Flag if it's imported but not locally declared (i.e., it's a re-export)
          if (importedIdentifiers.has(localName) && !localDeclarations.has(localName)) {
            context.report({
              node: exportSpecifier,
              messageId: "noReExportImported",
            });
          }
        }
      },
    };
  },
});
