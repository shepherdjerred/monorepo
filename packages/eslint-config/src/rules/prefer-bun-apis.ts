import { AST_NODE_TYPES, ESLintUtils } from "@typescript-eslint/utils";

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://github.com/shepherdjerred/share/tree/main/packages/eslint-config/src/rules/${name}.ts`,
);

export const preferBunApis = createRule({
  name: "prefer-bun-apis",
  meta: {
    type: "suggestion",
    docs: {
      description: "Prefer Bun APIs over Node.js equivalents for better performance and modern ESM support.",
    },
    messages: {
      preferBunEnv:
        "Use Bun.env instead of process.env to access environment variables. Bun.env is a more modern, typed alternative. See https://bun.sh/docs/runtime/env",
      preferImportMetaDir:
        "Use import.meta.dir instead of __dirname. import.meta.dir is the ESM-native way to get the directory path. See https://bun.sh/docs/api/import-meta",
      preferImportMetaPath:
        "Use import.meta.path instead of __filename. import.meta.path is the ESM-native way to get the file path. See https://bun.sh/docs/api/import-meta",
      preferEsmImport:
        "Use ESM import statements instead of require(). Bun fully supports ESM and it's the modern standard. Example: import { foo } from 'module'",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    return {
      // Check for process.env
      MemberExpression(node) {
        if (
          node.object.type === AST_NODE_TYPES.Identifier &&
          node.object.name === "process" &&
          node.property.type === AST_NODE_TYPES.Identifier &&
          node.property.name === "env"
        ) {
          context.report({
            node,
            messageId: "preferBunEnv",
          });
        }
      },

      // Check for __dirname and __filename
      Identifier(node) {
        // Skip if this identifier is being declared (e.g., in a variable declaration)
        if (node.parent.type === AST_NODE_TYPES.VariableDeclarator && node.parent.id === node) {
          return;
        }

        if (node.name === "__dirname") {
          context.report({
            node,
            messageId: "preferImportMetaDir",
          });
        } else if (node.name === "__filename") {
          context.report({
            node,
            messageId: "preferImportMetaPath",
          });
        }
      },

      // Check for require()
      CallExpression(node) {
        if (node.callee.type === AST_NODE_TYPES.Identifier && node.callee.name === "require") {
          context.report({
            node,
            messageId: "preferEsmImport",
          });
        }
      },
    };
  },
});
