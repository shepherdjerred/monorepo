/**
 * ESLint rule: knip-unused
 *
 * Reports unused files and exports detected by knip as ESLint warnings.
 * This enables IDE integration (Problems panel, inline squiggles, etc.)
 *
 * The rule runs knip once per lint session and caches results for efficiency.
 */

import { ESLintUtils, AST_NODE_TYPES } from "@typescript-eslint/utils";
import type { TSESTree } from "@typescript-eslint/utils";
import { getOrComputeKnip } from "./shared/tool-cache";
import { runKnip } from "./shared/tool-runner";

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://github.com/shepherdjerred/homelab/blob/main/eslint-rules/${name}.ts`,
);

type MessageIds = "unusedFile" | "unusedExport" | "unusedExportNoLoc";

type Options = [
  {
    reportUnusedFiles?: boolean;
    reportUnusedExports?: boolean;
  },
];

/**
 * ESLint rule to report knip findings
 */
export const knipUnused = createRule<Options, MessageIds>({
  name: "knip-unused",
  meta: {
    type: "problem",
    docs: {
      description: "Report unused files and exports detected by knip",
    },
    messages: {
      unusedFile: "File is unused and can be deleted (detected by knip)",
      unusedExport: "Export '{{symbol}}' is unused (detected by knip)",
      unusedExportNoLoc: "Export '{{symbol}}' is unused - location could not be determined (detected by knip)",
    },
    schema: [
      {
        type: "object",
        properties: {
          reportUnusedFiles: {
            type: "boolean",
            default: true,
          },
          reportUnusedExports: {
            type: "boolean",
            default: true,
          },
        },
        additionalProperties: false,
      },
    ],
  },
  defaultOptions: [
    {
      reportUnusedFiles: true,
      reportUnusedExports: true,
    },
  ],
  create(context, [options]) {
    const filename = context.filename;
    const projectRoot = context.cwd;

    // Get or compute knip results (cached per project)
    const knipResults = getOrComputeKnip(projectRoot, () => runKnip(projectRoot));

    // Check if this file has any knip issues
    const fileResult = knipResults.get(filename);
    if (!fileResult) {
      return {};
    }

    // Track which exports we've already reported (to avoid duplicates)
    const reportedExports = new Set<string>();

    // Helper to report unused export at a specific node
    function reportUnusedExportAt(node: TSESTree.Node, symbol: string): boolean {
      if (reportedExports.has(symbol)) {
        return false;
      }
      reportedExports.add(symbol);
      context.report({
        node,
        messageId: "unusedExport",
        data: { symbol },
      });
      return true;
    }

    // Build a map of symbol names to their expected locations from knip
    const symbolLocations = new Map<string, { line?: number; col?: number }>();
    for (const exp of fileResult.unusedExports) {
      symbolLocations.set(exp.symbol, { line: exp.line, col: exp.col });
    }

    return {
      // Report unused file on Program node (first line of file)
      Program(node) {
        if (options.reportUnusedFiles && fileResult.isUnusedFile) {
          context.report({
            node,
            loc: { line: 1, column: 0 },
            messageId: "unusedFile",
          });
        }

        // For exports without location info, report at end of program
        if (options.reportUnusedExports && !fileResult.isUnusedFile) {
          for (const exp of fileResult.unusedExports) {
            if (exp.line === undefined) {
              if (!reportedExports.has(exp.symbol)) {
                reportedExports.add(exp.symbol);
                context.report({
                  node,
                  loc: { line: 1, column: 0 },
                  messageId: "unusedExportNoLoc",
                  data: { symbol: exp.symbol },
                });
              }
            }
          }
        }
      },

      // Match export declarations to knip issues
      ExportNamedDeclaration(node) {
        if (!options.reportUnusedExports || fileResult.isUnusedFile) {
          return;
        }

        // export const foo = ...
        // export function foo() { ... }
        // export class Foo { ... }
        // export type Foo = ...
        // export interface Foo { ... }
        if (node.declaration) {
          const decl = node.declaration;

          // Variable declarations: export const foo = ..., export const { a, b } = ...
          if (decl.type === AST_NODE_TYPES.VariableDeclaration) {
            for (const declarator of decl.declarations) {
              if (declarator.id.type === AST_NODE_TYPES.Identifier) {
                const name = declarator.id.name;
                if (symbolLocations.has(name)) {
                  reportUnusedExportAt(declarator.id, name);
                }
              }
            }
          }

          // Function declarations: export function foo() {}
          if (decl.type === AST_NODE_TYPES.FunctionDeclaration && decl.id) {
            const name = decl.id.name;
            if (symbolLocations.has(name)) {
              reportUnusedExportAt(decl.id, name);
            }
          }

          // Class declarations: export class Foo {}
          if (decl.type === AST_NODE_TYPES.ClassDeclaration && decl.id) {
            const name = decl.id.name;
            if (symbolLocations.has(name)) {
              reportUnusedExportAt(decl.id, name);
            }
          }

          // Type alias: export type Foo = ...
          if (decl.type === AST_NODE_TYPES.TSTypeAliasDeclaration) {
            const name = decl.id.name;
            if (symbolLocations.has(name)) {
              reportUnusedExportAt(decl.id, name);
            }
          }

          // Interface: export interface Foo { ... }
          if (decl.type === AST_NODE_TYPES.TSInterfaceDeclaration) {
            const name = decl.id.name;
            if (symbolLocations.has(name)) {
              reportUnusedExportAt(decl.id, name);
            }
          }

          // Enum: export enum Foo { ... }
          if (decl.type === AST_NODE_TYPES.TSEnumDeclaration) {
            const name = decl.id.name;
            if (symbolLocations.has(name)) {
              reportUnusedExportAt(decl.id, name);
            }
          }
        }

        // export { foo, bar } or export { foo as bar }
        if (node.specifiers) {
          for (const spec of node.specifiers) {
            if (spec.type === AST_NODE_TYPES.ExportSpecifier) {
              // The exported name is in spec.exported
              const exportedName =
                spec.exported.type === AST_NODE_TYPES.Identifier ? spec.exported.name : spec.exported.value;

              if (symbolLocations.has(exportedName)) {
                reportUnusedExportAt(spec, exportedName);
              }
            }
          }
        }
      },

      // export default ...
      ExportDefaultDeclaration(node) {
        if (!options.reportUnusedExports || fileResult.isUnusedFile) {
          return;
        }

        // Check if "default" is in the unused exports
        if (symbolLocations.has("default")) {
          reportUnusedExportAt(node, "default");
        }
      },

      // export * from '...'
      ExportAllDeclaration(node) {
        if (!options.reportUnusedExports || fileResult.isUnusedFile) {
          return;
        }

        // export * as name from '...'
        if (node.exported) {
          const name = node.exported.type === AST_NODE_TYPES.Identifier ? node.exported.name : node.exported.value;

          if (symbolLocations.has(name)) {
            reportUnusedExportAt(node, name);
          }
        }
      },
    };
  },
});
