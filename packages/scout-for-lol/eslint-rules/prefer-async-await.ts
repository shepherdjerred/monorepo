import { AST_NODE_TYPES, ESLintUtils } from "@typescript-eslint/utils";
import type { TSESTree } from "@typescript-eslint/utils";

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://github.com/shepherdjerred/homelab/blob/main/eslint-rules/${name}.ts`,
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
    /**
     * Check if a node is a promise method call (.then, .catch, .finally)
     */
    function isPromiseMethodCall(
      node: TSESTree.CallExpression,
    ): { method: "then" | "catch" | "finally"; callee: TSESTree.MemberExpression } | null {
      if (
        node.callee.type !== AST_NODE_TYPES.MemberExpression ||
        node.callee.property.type !== AST_NODE_TYPES.Identifier
      ) {
        return null;
      }

      const methodName = node.callee.property.name;
      if (methodName === "then" || methodName === "catch" || methodName === "finally") {
        return { method: methodName, callee: node.callee };
      }

      return null;
    }

    /**
     * Check if this is an allowed pattern (Promise.resolve/reject static methods, constructors)
     */
    function isAllowedPattern(node: TSESTree.CallExpression): boolean {
      const callee = node.callee;
      if (callee.type !== AST_NODE_TYPES.MemberExpression) {
        return false;
      }

      const object = callee.object;

      // Allow Promise.resolve().then() and Promise.reject().then() as these are common patterns
      // for creating promises inline
      if (
        object.type === AST_NODE_TYPES.CallExpression &&
        object.callee.type === AST_NODE_TYPES.MemberExpression &&
        object.callee.object.type === AST_NODE_TYPES.Identifier &&
        object.callee.object.name === "Promise" &&
        object.callee.property.type === AST_NODE_TYPES.Identifier &&
        (object.callee.property.name === "resolve" || object.callee.property.name === "reject")
      ) {
        return true;
      }

      return false;
    }

    /**
     * Check if the object being called on looks like it could be a Promise.
     * This helps avoid false positives on objects that just happen to have .then() methods.
     */
    function looksLikePromise(node: TSESTree.Expression): boolean {
      // Call expressions (function calls) commonly return promises
      if (node.type === AST_NODE_TYPES.CallExpression) {
        return true;
      }

      // Identifiers could be promises if they're not object literals
      if (node.type === AST_NODE_TYPES.Identifier) {
        return true;
      }

      // Member expressions (object.property) could be promises
      if (node.type === AST_NODE_TYPES.MemberExpression) {
        return true;
      }

      // new Promise() constructor
      if (node.type === AST_NODE_TYPES.NewExpression) {
        return true;
      }

      // Await expressions return values that could be promises
      if (node.type === AST_NODE_TYPES.AwaitExpression) {
        return true;
      }

      // Conditional expressions could return promises
      if (node.type === AST_NODE_TYPES.ConditionalExpression) {
        return true;
      }

      // Object literals are NOT promises - they may have .then() as a regular method
      if (node.type === AST_NODE_TYPES.ObjectExpression) {
        return false;
      }

      // Array literals are NOT promises
      if (node.type === AST_NODE_TYPES.ArrayExpression) {
        return false;
      }

      return false;
    }

    /**
     * Check if node is inside an expression that already uses await
     * This avoids flagging patterns like: await promise.catch(handleError)
     */
    function isAwaitedExpression(node: TSESTree.Node): boolean {
      let current: TSESTree.Node | undefined = node.parent;
      while (current) {
        if (current.type === AST_NODE_TYPES.AwaitExpression) {
          return true;
        }
        // Stop at function boundaries
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

        // Skip allowed patterns
        if (isAllowedPattern(node)) {
          return;
        }

        // Skip if this is part of an awaited expression (e.g., await promise.catch())
        // These patterns can be valid for adding default error handling while still using await
        if (isAwaitedExpression(node)) {
          return;
        }

        // Skip if the object doesn't look like a Promise
        // This avoids false positives on objects that just happen to have .then() methods
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
