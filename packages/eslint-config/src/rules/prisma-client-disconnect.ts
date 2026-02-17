import {
  AST_NODE_TYPES,
  ESLintUtils,
  type TSESTree,
} from "@typescript-eslint/utils";

const createRule = ESLintUtils.RuleCreator(
  (name) =>
    `https://github.com/shepherdjerred/share/tree/main/packages/eslint-config/src/rules/${name}.ts`,
);

type MessageIds = "missingDisconnect";
type Options = [];

export const prismaClientDisconnect = createRule<Options, MessageIds>({
  name: "prisma-client-disconnect",
  meta: {
    type: "problem",
    docs: {
      description:
        "Ensure PrismaClient instances are disconnected in afterAll hooks in integration tests to prevent database lock issues",
    },
    messages: {
      missingDisconnect:
        "PrismaClient '{{ variable }}' must be disconnected in an afterAll() hook to prevent database lock issues",
    },
    schema: [],
    fixable: "code",
  },
  defaultOptions: [],
  create(context) {
    const sourceCode = context.sourceCode;
    const filename = context.filename;

    // Only check integration test files
    if (!filename.includes(".integration.test.ts")) {
      return {};
    }

    const prismaClientNodes: {
      variable: string;
      node: TSESTree.VariableDeclarator;
    }[] = [];
    let hasAfterAllWithDisconnect = false;
    let lastLifecycleHook: TSESTree.Node | undefined;
    let bunTestImport: TSESTree.ImportDeclaration | undefined;
    let hasAfterAllImport = false;

    return {
      // Track imports from "bun:test" and check if afterAll is imported
      "ImportDeclaration[source.value='bun:test']"(
        node: TSESTree.ImportDeclaration,
      ) {
        bunTestImport = node;
        // Check if afterAll is already imported
        hasAfterAllImport = node.specifiers.some(
          (spec) =>
            spec.type === AST_NODE_TYPES.ImportSpecifier &&
            spec.imported.type === AST_NODE_TYPES.Identifier &&
            spec.imported.name === "afterAll",
        );
      },

      // Track PrismaClient instantiations
      "VariableDeclarator[init.callee.name='PrismaClient']"(
        node: TSESTree.VariableDeclarator,
      ) {
        if (node.id.type === AST_NODE_TYPES.Identifier) {
          prismaClientNodes.push({ variable: node.id.name, node });
        }
      },

      // Track lifecycle hooks (beforeEach, afterEach, beforeAll)
      "CallExpression[callee.name='beforeEach'], CallExpression[callee.name='afterEach'], CallExpression[callee.name='beforeAll']"(
        node: TSESTree.CallExpression,
      ) {
        // Find the parent ExpressionStatement to get the full statement
        let parent: TSESTree.Node | undefined = node.parent;
        while (
          parent !== undefined &&
          parent.type !== AST_NODE_TYPES.ExpressionStatement
        ) {
          parent = parent.parent;
        }
        if (parent !== undefined) {
          lastLifecycleHook = parent;
        }
      },

      // Check for afterAll with disconnect
      "CallExpression[callee.name='afterAll']"(node: TSESTree.CallExpression) {
        const callback = node.arguments[0];
        if (callback === undefined) {
          return;
        }

        // Check if the callback body contains a $disconnect call
        if (
          callback.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
          callback.type !== AST_NODE_TYPES.FunctionExpression
        ) {
          return;
        }

        if (callback.body.type !== AST_NODE_TYPES.BlockStatement) {
          return;
        }

        const hasDisconnectCall = callback.body.body.some((stmt) => {
          return sourceCode.getText(stmt).includes("$disconnect");
        });

        if (hasDisconnectCall) {
          hasAfterAllWithDisconnect = true;
        }
      },

      // Report at end of program
      "Program:exit"() {
        if (prismaClientNodes.length > 0 && !hasAfterAllWithDisconnect) {
          // Report on each PrismaClient instantiation
          for (const [
            index,
            { variable, node: prismaNode },
          ] of prismaClientNodes.entries()) {
            context.report({
              node: prismaNode,
              messageId: "missingDisconnect",
              data: {
                variable,
              },
              // Only provide fix on the first reported error to avoid duplication
              ...(index === 0
                ? {
                    fix: (
                      fixer,
                    ): ReturnType<typeof fixer.replaceText>[] | null => {
                      const fixes: ReturnType<typeof fixer.replaceText>[] = [];

                      // Add afterAll to imports if missing
                      if (!hasAfterAllImport && bunTestImport !== undefined) {
                        // Find the closing brace of the import specifiers
                        const importText = sourceCode.getText(bunTestImport);
                        // Use more specific regex without overlapping quantifiers
                        const importRegex = /^import\s*\{([^}]+)\}\s*from/;
                        const importMatch = importRegex.exec(importText);

                        if (importMatch !== null) {
                          // Add afterAll to the import list
                          const newImportText = importText.replace(
                            /^(import\s*\{)([^}]+)(\}\s*from)/,
                            "$1afterAll, $2$3",
                          );
                          fixes.push(
                            fixer.replaceText(bunTestImport, newImportText),
                          );
                        }
                      }

                      // Generate the afterAll hook for all PrismaClient variables
                      const disconnectCalls = prismaClientNodes
                        .map((pc) => `  await ${pc.variable}.$disconnect();`)
                        .join("\n");

                      const afterAllHook = `\nafterAll(async () => {\n${disconnectCalls}\n});\n`;

                      // Find the best insertion point:
                      // 1. After the last lifecycle hook (beforeEach/afterEach/beforeAll)
                      // 2. Otherwise, after the PrismaClient instantiation's parent statement
                      let insertionPoint: TSESTree.Node | undefined;

                      if (lastLifecycleHook !== undefined) {
                        insertionPoint = lastLifecycleHook;
                      } else {
                        // Find the top-level statement containing the first PrismaClient instantiation
                        const firstPrismaNode = prismaClientNodes[0];
                        if (firstPrismaNode !== undefined) {
                          let current: TSESTree.Node = firstPrismaNode.node;
                          // Walk up until we find a direct child of the Program
                          while (
                            current.parent.type !== AST_NODE_TYPES.Program
                          ) {
                            current = current.parent;
                          }
                          insertionPoint = current;
                        }
                      }

                      if (insertionPoint === undefined) {
                        return null;
                      }

                      fixes.push(
                        fixer.insertTextAfter(insertionPoint, afterAllHook),
                      );

                      return fixes;
                    },
                  }
                : {}),
            });
          }
        }
      },
    };
  },
});
