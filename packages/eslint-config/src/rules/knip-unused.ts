/**
 * Reports unused files and exports detected by knip.
 */

import { AST_NODE_TYPES, ESLintUtils } from "@typescript-eslint/utils";
import type { TSESTree } from "@typescript-eslint/utils";
import { getOrComputeKnip } from "./shared/tool-cache.js";
import { runKnip } from "./shared/tool-runner.js";

const createRule = ESLintUtils.RuleCreator(
  (name) =>
    `https://github.com/shepherdjerred/share/blob/main/packages/eslint-config/src/rules/${name}.ts`,
);

type MessageIds = "unusedFile" | "unusedExport" | "unusedExportNoLoc";

type Options = [
  {
    reportUnusedFiles?: boolean;
    reportUnusedExports?: boolean;
  },
];

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
      unusedExportNoLoc:
        "Export '{{symbol}}' is unused - location could not be determined (detected by knip)",
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
    const knipResults = getOrComputeKnip(projectRoot, () =>
      runKnip(projectRoot),
    );

    const fileResult = knipResults.get(filename);
    if (!fileResult) {
      return {};
    }

    const reportedExports = new Set<string>();

    function reportUnusedExportAt(
      node: TSESTree.Node,
      symbol: string,
    ): boolean {
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

    const symbolLocations = new Map<string, { line?: number; col?: number }>();
    for (const exp of fileResult.unusedExports) {
      const loc: { line?: number; col?: number } = {};
      if (exp.line !== undefined) {
        loc.line = exp.line;
      }
      if (exp.col !== undefined) {
        loc.col = exp.col;
      }
      symbolLocations.set(exp.symbol, loc);
    }

    return {
      Program(node) {
        if (options.reportUnusedFiles && fileResult.isUnusedFile) {
          context.report({
            node,
            loc: { line: 1, column: 0 },
            messageId: "unusedFile",
          });
        }

        if (options.reportUnusedExports && !fileResult.isUnusedFile) {
          for (const exp of fileResult.unusedExports) {
            if (exp.line === undefined && !reportedExports.has(exp.symbol)) {
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
      },

      ExportNamedDeclaration(node) {
        if (!options.reportUnusedExports || fileResult.isUnusedFile) {
          return;
        }

        if (node.declaration) {
          const decl = node.declaration;

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

          if (decl.type === AST_NODE_TYPES.FunctionDeclaration && decl.id) {
            const name = decl.id.name;
            if (symbolLocations.has(name)) {
              reportUnusedExportAt(decl.id, name);
            }
          }

          if (decl.type === AST_NODE_TYPES.ClassDeclaration && decl.id) {
            const name = decl.id.name;
            if (symbolLocations.has(name)) {
              reportUnusedExportAt(decl.id, name);
            }
          }

          if (decl.type === AST_NODE_TYPES.TSTypeAliasDeclaration) {
            const name = decl.id.name;
            if (symbolLocations.has(name)) {
              reportUnusedExportAt(decl.id, name);
            }
          }

          if (decl.type === AST_NODE_TYPES.TSInterfaceDeclaration) {
            const name = decl.id.name;
            if (symbolLocations.has(name)) {
              reportUnusedExportAt(decl.id, name);
            }
          }

          if (decl.type === AST_NODE_TYPES.TSEnumDeclaration) {
            const name = decl.id.name;
            if (symbolLocations.has(name)) {
              reportUnusedExportAt(decl.id, name);
            }
          }
        }

        if (node.specifiers) {
          for (const spec of node.specifiers) {
            if (spec.type === AST_NODE_TYPES.ExportSpecifier) {
              const exportedName =
                spec.exported.type === AST_NODE_TYPES.Identifier
                  ? spec.exported.name
                  : spec.exported.value;

              if (symbolLocations.has(exportedName)) {
                reportUnusedExportAt(spec, exportedName);
              }
            }
          }
        }
      },

      ExportDefaultDeclaration(node) {
        if (!options.reportUnusedExports || fileResult.isUnusedFile) {
          return;
        }

        if (symbolLocations.has("default")) {
          reportUnusedExportAt(node, "default");
        }
      },

      ExportAllDeclaration(node) {
        if (!options.reportUnusedExports || fileResult.isUnusedFile) {
          return;
        }

        if (node.exported) {
          const name = node.exported.name;
          if (symbolLocations.has(name)) {
            reportUnusedExportAt(node, name);
          }
        }
      },
    };
  },
});
