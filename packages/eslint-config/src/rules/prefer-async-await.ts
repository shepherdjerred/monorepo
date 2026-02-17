import { AST_NODE_TYPES, ESLintUtils } from "@typescript-eslint/utils";
import type { TSESTree } from "@typescript-eslint/utils";

const createRule = ESLintUtils.RuleCreator(
  (name) =>
    `https://github.com/shepherdjerred/monorepo/blob/main/packages/eslint-config/src/rules/${name}.ts`,
);

type MessageIds = "preferAsyncAwait" | "preferTryCatch" | "preferAwait";

export const preferAsyncAwait = createRule<[], MessageIds>({
  name: "prefer-async-await",
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Enforce async/await syntax over Promise.then() and Promise.catch() chains. Async/await provides cleaner, more readable code with better error handling and debugging support.",
    },
    messages: {
      preferAsyncAwait:
        "Avoid promise chaining with .then(). Use async/await syntax instead for cleaner, more readable code. Example: `const result = await promise;` instead of `promise.then(result => ...)`.",
      preferTryCatch:
        "Avoid .catch() for error handling. Use try/catch with async/await instead. Example: `try { const result = await promise; } catch (error) { ... }`.",
      preferAwait:
        "Avoid .finally() with promise chains. Use try/finally with async/await instead. Example: `try { await promise; } finally { cleanup(); }`.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    function isPromiseMethodCall(
      node: TSESTree.CallExpression,
    ): {
      method: "then" | "catch" | "finally";
      callee: TSESTree.MemberExpression;
    } | null {
      if (
        node.callee.type !== AST_NODE_TYPES.MemberExpression ||
        node.callee.property.type !== AST_NODE_TYPES.Identifier
      ) {
        return null;
      }

      const methodName = node.callee.property.name;
      if (
        methodName === "then" ||
        methodName === "catch" ||
        methodName === "finally"
      ) {
        return { method: methodName, callee: node.callee };
      }

      return null;
    }

    function isAllowedPattern(node: TSESTree.CallExpression): boolean {
      const callee = node.callee;
      if (callee.type !== AST_NODE_TYPES.MemberExpression) {
        return false;
      }

      const object = callee.object;

      if (
        object.type === AST_NODE_TYPES.CallExpression &&
        object.callee.type === AST_NODE_TYPES.MemberExpression &&
        object.callee.object.type === AST_NODE_TYPES.Identifier &&
        object.callee.object.name === "Promise" &&
        object.callee.property.type === AST_NODE_TYPES.Identifier &&
        (object.callee.property.name === "resolve" ||
          object.callee.property.name === "reject")
      ) {
        return true;
      }

      return false;
    }

    function looksLikePromise(node: TSESTree.Expression): boolean {
      if (node.type === AST_NODE_TYPES.CallExpression) {
        return true;
      }
      if (node.type === AST_NODE_TYPES.Identifier) {
        return true;
      }
      if (node.type === AST_NODE_TYPES.MemberExpression) {
        return true;
      }
      if (node.type === AST_NODE_TYPES.NewExpression) {
        return true;
      }
      if (node.type === AST_NODE_TYPES.AwaitExpression) {
        return true;
      }
      if (node.type === AST_NODE_TYPES.ConditionalExpression) {
        return true;
      }
      return false;
    }

    function isAwaitedExpression(node: TSESTree.Node): boolean {
      let current: TSESTree.Node | undefined = node.parent;
      while (current) {
        if (current.type === AST_NODE_TYPES.AwaitExpression) {
          return true;
        }
        if (
          current.type === AST_NODE_TYPES.FunctionDeclaration ||
          current.type === AST_NODE_TYPES.FunctionExpression ||
          current.type === AST_NODE_TYPES.ArrowFunctionExpression
        ) {
          break;
        }
        current = current.parent;
      }
      return false;
    }

    return {
      CallExpression(node: TSESTree.CallExpression) {
        const promiseMethod = isPromiseMethodCall(node);
        if (!promiseMethod) {
          return;
        }

        if (isAllowedPattern(node)) {
          return;
        }

        if (isAwaitedExpression(node)) {
          return;
        }

        if (!looksLikePromise(promiseMethod.callee.object)) {
          return;
        }

        const messageId: MessageIds =
          promiseMethod.method === "then"
            ? "preferAsyncAwait"
            : promiseMethod.method === "catch"
              ? "preferTryCatch"
              : "preferAwait";

        context.report({
          node,
          messageId,
        });
      },
    };
  },
});
