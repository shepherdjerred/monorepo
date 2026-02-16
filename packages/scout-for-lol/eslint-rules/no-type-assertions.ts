import { AST_NODE_TYPES, ESLintUtils } from "@typescript-eslint/utils";

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://github.com/shepherdjerred/homelab/blob/main/eslint-rules/${name}.ts`,
);

export const noTypeAssertions = createRule({
  name: "no-type-assertions",
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow type assertions except for casting to 'unknown' or 'as const'. Prefer Zod schema validation for type narrowing.",
    },
    messages: {
      noAsExpression:
        "Type assertions are not allowed except for casting to 'unknown' or 'as const'. Use 'value as unknown' to widen to unknown, 'value as const' for const assertions, or Zod schema validation to safely narrow types.",
      noTypeAssertion:
        "Type assertions are not allowed except for casting to 'unknown'. Use 'value as unknown' if you need to cast to unknown, otherwise use Zod schema validation.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    return {
      TSAsExpression(node) {
        // Allow 'as unknown'
        if (node.typeAnnotation.type === AST_NODE_TYPES.TSUnknownKeyword) {
          return;
        }

        // Allow 'as const'
        if (
          node.typeAnnotation.type === AST_NODE_TYPES.TSTypeReference &&
          node.typeAnnotation.typeName.type === AST_NODE_TYPES.Identifier &&
          node.typeAnnotation.typeName.name === "const"
        ) {
          return;
        }

        // Disallow chained assertions like 'x as unknown as Type'
        // This is checking the outer 'as Type' where expression is another TSAsExpression
        if (node.expression.type === AST_NODE_TYPES.TSAsExpression) {
          // The expression is already a type assertion, so this is a chain
          context.report({
            node,
            messageId: "noAsExpression",
          });
          return;
        }

        // All other 'as' assertions are disallowed
        context.report({
          node,
          messageId: "noAsExpression",
        });
      },

      TSTypeAssertion(node) {
        // Allow '<unknown>value'
        if (node.typeAnnotation.type === AST_NODE_TYPES.TSUnknownKeyword) {
          return;
        }

        // All other type assertions are disallowed
        context.report({
          node,
          messageId: "noTypeAssertion",
        });
      },
    };
  },
});
