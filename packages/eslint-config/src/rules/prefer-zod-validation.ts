import { AST_NODE_TYPES, ESLintUtils } from "@typescript-eslint/utils";
import type { TSESTree } from "@typescript-eslint/utils";

const createRule = ESLintUtils.RuleCreator(
  (name) =>
    `https://github.com/shepherdjerred/share/tree/main/packages/eslint-config/src/rules/${name}.ts`,
);

export const preferZodValidation = createRule({
  name: "prefer-zod-validation",
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Flag complex type checking chains. Use Zod to validate the entire structure once instead of checking multiple levels with typeof/instanceof/'in' chains.",
    },
    messages: {
      repeatedTypeChecking:
        "Repeated type checking on nested properties should use Zod validation instead. Validate the entire structure once with a Zod schema.",
      complexTypeChecking:
        "Complex type checking chain detected ({{count}} checks). Use Zod validation to validate the entire structure once with a schema.",
      objectTypeCheck:
        "Object shape checking with typeof/in operator chains should use Zod validation instead. Define a schema and use schema.safeParse(value) for runtime-validated types.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    // Track typeof/instanceof checks on member expressions (for repeated checks on same path)
    const typeCheckMap = new Map<string, TSESTree.Node[]>();

    function getMemberPath(node: TSESTree.Node): string | null {
      if (node.type === AST_NODE_TYPES.MemberExpression) {
        const parts: string[] = [];
        let current: TSESTree.Node | undefined = node;

        while (current.type === AST_NODE_TYPES.MemberExpression) {
          if (current.property.type === AST_NODE_TYPES.Identifier) {
            parts.unshift(current.property.name);
          } else if (
            current.property.type === AST_NODE_TYPES.Literal &&
            typeof current.property.value === "string"
          ) {
            parts.unshift(current.property.value);
          } else {
            return null;
          }
          current = current.object;
        }

        if (current.type === AST_NODE_TYPES.Identifier) {
          parts.unshift(current.name);
          return parts.join(".");
        }
      }

      return null;
    }

    // Check if a node is a type-checking operation
    function isTypeCheck(node: TSESTree.Node): boolean {
      // typeof checks
      if (
        node.type === AST_NODE_TYPES.UnaryExpression &&
        node.operator === "typeof"
      ) {
        return true;
      }

      // instanceof checks
      if (
        node.type === AST_NODE_TYPES.BinaryExpression &&
        node.operator === "instanceof"
      ) {
        return true;
      }

      // 'in' operator checks
      if (
        node.type === AST_NODE_TYPES.BinaryExpression &&
        node.operator === "in"
      ) {
        return true;
      }

      // typeof comparisons (typeof x === "string")
      if (node.type === AST_NODE_TYPES.BinaryExpression) {
        if (
          (node.operator === "===" || node.operator === "!==") &&
          node.left.type === AST_NODE_TYPES.UnaryExpression &&
          node.left.operator === "typeof"
        ) {
          return true;
        }
      }

      return false;
    }

    // Count type checks in a logical expression chain
    function countTypeChecks(node: TSESTree.Node): number {
      if (node.type === AST_NODE_TYPES.LogicalExpression) {
        const leftCount = countTypeChecks(node.left);
        const rightCount = countTypeChecks(node.right);
        return leftCount + rightCount;
      }

      if (isTypeCheck(node)) {
        return 1;
      }

      // For binary expressions that contain typeof
      if (node.type === AST_NODE_TYPES.BinaryExpression) {
        if (
          node.left.type === AST_NODE_TYPES.UnaryExpression &&
          node.left.operator === "typeof"
        ) {
          return 1;
        }
      }

      return 0;
    }

    return {
      // Track typeof checks on member expressions (for repeated checks)
      UnaryExpression(node) {
        if (
          node.operator === "typeof" &&
          node.argument.type === AST_NODE_TYPES.MemberExpression
        ) {
          const path = getMemberPath(node.argument);
          if (path) {
            const checks = typeCheckMap.get(path) ?? [];
            checks.push(node);
            typeCheckMap.set(path, checks);

            // Flag if we're checking the same path multiple times
            if (checks.length > 1) {
              context.report({
                node,
                messageId: "repeatedTypeChecking",
              });
            }
          }
        }
      },

      // Track instanceof checks on member expressions (for repeated checks)
      BinaryExpression(node) {
        if (
          node.operator === "instanceof" &&
          node.left.type === AST_NODE_TYPES.MemberExpression
        ) {
          const path = getMemberPath(node.left);
          if (path) {
            const checks = typeCheckMap.get(path) ?? [];
            checks.push(node);
            typeCheckMap.set(path, checks);

            // Flag if we're checking the same path multiple times
            if (checks.length > 1) {
              context.report({
                node,
                messageId: "repeatedTypeChecking",
              });
            }
          }
        }
      },

      // Detect complex type checking chains in logical expressions
      LogicalExpression(node) {
        // Only check at the top level of a logical expression chain
        // (avoid reporting on every sub-expression)
        const parent = node.parent;
        if (parent.type === AST_NODE_TYPES.LogicalExpression) {
          return; // Let the parent handle it
        }

        // Collect all leaf terms of the && chain
        const terms: TSESTree.Node[] = [];
        function collectTerms(n: TSESTree.Node): void {
          if (
            n.type === AST_NODE_TYPES.LogicalExpression &&
            n.operator === "&&"
          ) {
            collectTerms(n.left);
            collectTerms(n.right);
          } else {
            terms.push(n);
          }
        }
        if (node.operator === "&&") {
          collectTerms(node);
        }

        // Detect object shape checking: typeof X === "object" && "field" in X
        // Both checks must reference the same variable
        function getIdentifierName(n: TSESTree.Node): string | null {
          if (n.type === AST_NODE_TYPES.Identifier) return n.name;
          return null;
        }

        const typeofObjectVars = new Set<string>();
        const inCheckVars = new Set<string>();
        for (const term of terms) {
          if (
            term.type === AST_NODE_TYPES.BinaryExpression &&
            (term.operator === "===" || term.operator === "!==") &&
            term.left.type === AST_NODE_TYPES.UnaryExpression &&
            term.left.operator === "typeof" &&
            term.right.type === AST_NODE_TYPES.Literal &&
            term.right.value === "object"
          ) {
            const name = getIdentifierName(term.left.argument);
            if (name) typeofObjectVars.add(name);
          }
          if (
            term.type === AST_NODE_TYPES.BinaryExpression &&
            term.operator === "in"
          ) {
            const name = getIdentifierName(term.right);
            if (name) inCheckVars.add(name);
          }
        }

        let hasObjectShapeCheck = false;
        for (const v of typeofObjectVars) {
          if (inCheckVars.has(v)) {
            hasObjectShapeCheck = true;
            break;
          }
        }

        if (hasObjectShapeCheck) {
          context.report({
            node,
            messageId: "objectTypeCheck",
          });
          return;
        }

        const typeCheckCount = countTypeChecks(node);

        // Flag if there are 3 or more type checks chained together
        if (typeCheckCount >= 3) {
          context.report({
            node,
            messageId: "complexTypeChecking",
            data: {
              count: typeCheckCount.toString(),
            },
          });
        }
      },
    };
  },
});
