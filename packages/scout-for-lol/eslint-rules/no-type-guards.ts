import { AST_NODE_TYPES, ESLintUtils } from "@typescript-eslint/utils";
import type { TSESTree } from "@typescript-eslint/utils";

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://github.com/shepherdjerred/homelab/blob/main/eslint-rules/${name}.ts`,
);

export const noTypeGuards = createRule({
  name: "no-type-guards",
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow type guard functions (functions with 'value is Type' return type predicates). Use Zod schema validation instead for runtime type safety.",
    },
    messages: {
      noTypeGuard:
        "Type guard functions are not safe. Use Zod schema validation instead. Replace 'function isX(value): value is Type' with a Zod schema and 'Schema.parse(value)' or 'Schema.safeParse(value)'.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    /**
     * Check if a return type annotation is a type predicate (e.g., "value is Type")
     */
    function isTypePredicate(node: TSESTree.TSTypeAnnotation | undefined): boolean {
      if (!node) {
        return false;
      }

      // Check for type predicate: "value is Type"
      if (node.typeAnnotation.type === AST_NODE_TYPES.TSTypePredicate) {
        return true;
      }

      return false;
    }

    /**
     * Check if a function declaration has a type predicate return type
     */
    function checkFunctionDeclaration(node: TSESTree.FunctionDeclaration): void {
      if (isTypePredicate(node.returnType)) {
        context.report({
          node,
          messageId: "noTypeGuard",
        });
      }
    }

    /**
     * Check if a function expression has a type predicate return type
     */
    function checkFunctionExpression(node: TSESTree.FunctionExpression): void {
      if (isTypePredicate(node.returnType)) {
        context.report({
          node,
          messageId: "noTypeGuard",
        });
      }
    }

    /**
     * Check if an arrow function has a type predicate return type
     */
    function checkArrowFunction(node: TSESTree.ArrowFunctionExpression): void {
      // Arrow functions can have return type annotations
      if (node.returnType && isTypePredicate(node.returnType)) {
        context.report({
          node,
          messageId: "noTypeGuard",
        });
      }
    }

    /**
     * Check if a method has a type predicate return type
     */
    function checkMethod(node: TSESTree.MethodDefinition | TSESTree.TSMethodSignature): void {
      if (isTypePredicate(node.returnType)) {
        context.report({
          node,
          messageId: "noTypeGuard",
        });
      }
    }

    return {
      FunctionDeclaration: checkFunctionDeclaration,
      FunctionExpression: checkFunctionExpression,
      ArrowFunctionExpression: checkArrowFunction,
      MethodDefinition: checkMethod,
      TSMethodSignature: checkMethod,
    };
  },
});
