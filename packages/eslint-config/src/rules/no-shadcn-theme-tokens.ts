import {
  AST_NODE_TYPES,
  ESLintUtils,
  type TSESTree,
} from "@typescript-eslint/utils";

const createRule = ESLintUtils.RuleCreator(
  (name) =>
    `https://github.com/shepherdjerred/share/blob/main/packages/eslint-config/src/rules/${name}.ts`,
);

const SHADCN_TOKENS = [
  "text-foreground",
  "text-muted-foreground",
  "text-primary-foreground",
  "text-secondary-foreground",
  "text-accent-foreground",
  "text-destructive-foreground",
  "text-card-foreground",
  "text-popover-foreground",
  "text-destructive",
  "text-primary",
  "text-secondary",
  "text-muted",
  "text-accent",
  "bg-background",
  "bg-foreground",
  "bg-primary",
  "bg-secondary",
  "bg-muted",
  "bg-accent",
  "bg-destructive",
  "bg-card",
  "bg-popover",
  "bg-primary-foreground",
  "bg-secondary-foreground",
  "bg-muted-foreground",
  "bg-accent-foreground",
  "bg-destructive-foreground",
  "border-border",
  "border-input",
  "border-ring",
  "border-primary",
  "border-secondary",
  "border-muted",
  "border-accent",
  "border-destructive",
  "ring-ring",
  "ring-primary",
  "ring-secondary",
  "ring-muted",
  "ring-accent",
  "ring-destructive",
  "outline-ring",
  "outline-primary",
  "outline-secondary",
];

const TOKEN_PATTERN = new RegExp(`\\b(${SHADCN_TOKENS.join("|")})\\b`, "g");

export const noShadcnThemeTokens = createRule({
  name: "no-shadcn-theme-tokens",
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Prevent shadcn theme tokens in marketing-style components. Prefer explicit Tailwind classes for predictable styling.",
    },
    messages: {
      noShadcnToken:
        "Found shadcn theme token '{{token}}'. Use explicit Tailwind classes instead for predictable style behavior.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    function checkStringForTokens(value: string, node: TSESTree.Node) {
      const matches = value.match(TOKEN_PATTERN);
      if (!matches) {
        return;
      }

      const uniqueTokens = [...new Set(matches)];
      for (const token of uniqueTokens) {
        context.report({
          node,
          messageId: "noShadcnToken",
          data: { token },
        });
      }
    }

    function checkNode(node: TSESTree.Node) {
      if (
        node.type === AST_NODE_TYPES.Literal &&
        typeof node.value === "string"
      ) {
        checkStringForTokens(node.value, node);
      }

      if (node.type === AST_NODE_TYPES.TemplateLiteral) {
        for (const quasi of node.quasis) {
          checkStringForTokens(quasi.value.raw, quasi);
        }
      }
    }

    function isClassAttribute(name: string): boolean {
      return (
        name === "class" || name === "className" || name.startsWith("class:")
      );
    }

    return {
      JSXAttribute(node) {
        if (
          node.name.type === AST_NODE_TYPES.JSXIdentifier &&
          isClassAttribute(node.name.name) &&
          node.value
        ) {
          if (
            node.value.type === AST_NODE_TYPES.Literal &&
            typeof node.value.value === "string"
          ) {
            checkStringForTokens(node.value.value, node.value);
          }

          if (node.value.type === AST_NODE_TYPES.JSXExpressionContainer) {
            if (node.value.expression.type === AST_NODE_TYPES.TemplateLiteral) {
              checkNode(node.value.expression);
            }

            if (
              node.value.expression.type === AST_NODE_TYPES.Literal &&
              typeof node.value.expression.value === "string"
            ) {
              checkStringForTokens(
                node.value.expression.value,
                node.value.expression,
              );
            }
          }
        }
      },

      CallExpression(node) {
        if (node.callee.type === AST_NODE_TYPES.Identifier) {
          const fnName = node.callee.name;
          if (
            ["cn", "clsx", "classnames", "twMerge", "classNames"].includes(
              fnName,
            )
          ) {
            for (const arg of node.arguments) {
              checkNode(arg);
            }
          }
        }
      },

      ArrayExpression(node) {
        for (const element of node.elements) {
          if (
            element &&
            element.type === AST_NODE_TYPES.Literal &&
            typeof element.value === "string"
          ) {
            checkStringForTokens(element.value, element);
          }
        }
      },
    };
  },
});
