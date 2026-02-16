import { ESLintUtils, AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://github.com/shepherdjerred/scout-for-lol/blob/main/eslint-rules/${name}.ts`,
);

/**
 * shadcn theme tokens that should not be used in marketing components.
 * These tokens swap colors based on light/dark theme, which can cause
 * unexpected color changes in marketing pages.
 */
const SHADCN_TOKENS = [
  // Text colors
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
  // Background colors
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
  // Border colors
  "border-border",
  "border-input",
  "border-ring",
  "border-primary",
  "border-secondary",
  "border-muted",
  "border-accent",
  "border-destructive",
  // Ring colors
  "ring-ring",
  "ring-primary",
  "ring-secondary",
  "ring-muted",
  "ring-accent",
  "ring-destructive",
  // Outline colors
  "outline-ring",
  "outline-primary",
  "outline-secondary",
];

// Create a regex pattern to match any of the tokens as whole words in class strings
const TOKEN_PATTERN = new RegExp(`\\b(${SHADCN_TOKENS.join("|")})\\b`, "g");

/**
 * ESLint rule to prevent shadcn theme tokens in marketing components.
 *
 * Marketing components should use explicit Tailwind colors (e.g., text-gray-900 dark:text-white)
 * instead of shadcn theme tokens (e.g., text-foreground) to ensure predictable dark mode behavior.
 *
 * shadcn tokens are allowed in:
 * - components/ui/** (shadcn component library)
 * - components/review-tool/ui/** (review tool UI components)
 */
export const noShadcnThemeTokens = createRule({
  name: "no-shadcn-theme-tokens",
  meta: {
    type: "suggestion",
    docs: {
      description: "Prevent shadcn theme tokens in marketing components. Use explicit Tailwind colors instead.",
    },
    messages: {
      noShadcnToken:
        "Found shadcn theme token '{{token}}'. Marketing components should use explicit Tailwind colors (e.g., text-gray-900 dark:text-white) instead of theme tokens for predictable dark mode behavior.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    function checkStringForTokens(value: string, node: TSESTree.Node) {
      const matches = value.match(TOKEN_PATTERN);
      if (matches) {
        // Report each unique token found
        const uniqueTokens = [...new Set(matches)];
        for (const token of uniqueTokens) {
          context.report({
            node,
            messageId: "noShadcnToken",
            data: { token },
          });
        }
      }
    }

    function checkNode(node: TSESTree.Node) {
      // Check string literals
      if (node.type === AST_NODE_TYPES.Literal && typeof node.value === "string") {
        checkStringForTokens(node.value, node);
      }

      // Check template literals
      if (node.type === AST_NODE_TYPES.TemplateLiteral) {
        for (const quasi of node.quasis) {
          checkStringForTokens(quasi.value.raw, quasi);
        }
      }
    }

    function isClassAttribute(name: string): boolean {
      // Match class, className, class:list (Astro), and similar
      return name === "class" || name === "className" || name.startsWith("class:");
    }

    return {
      // Check JSX attributes: className="..." or class="..."
      JSXAttribute(node) {
        if (node.name.type === AST_NODE_TYPES.JSXIdentifier && isClassAttribute(node.name.name) && node.value) {
          // Direct string value: className="text-foreground"
          if (node.value.type === AST_NODE_TYPES.Literal && typeof node.value.value === "string") {
            checkStringForTokens(node.value.value, node.value);
          }

          // Expression container: className={...}
          if (node.value.type === AST_NODE_TYPES.JSXExpressionContainer) {
            // Check template literals: className={`...`}
            if (node.value.expression.type === AST_NODE_TYPES.TemplateLiteral) {
              checkNode(node.value.expression);
            }

            // Check string literals in expression: className={"..."}
            if (
              node.value.expression.type === AST_NODE_TYPES.Literal &&
              typeof node.value.expression.value === "string"
            ) {
              checkStringForTokens(node.value.expression.value, node.value.expression);
            }
          }
        }
      },

      // Check function calls like cn(), clsx(), classnames(), twMerge()
      CallExpression(node) {
        if (node.callee.type === AST_NODE_TYPES.Identifier) {
          const fnName = node.callee.name;
          // Common class merging utilities
          if (["cn", "clsx", "classnames", "twMerge", "classNames"].includes(fnName)) {
            for (const arg of node.arguments) {
              checkNode(arg);
            }
          }
        }
      },

      // Check object properties in class arrays: class:list={["text-foreground"]}
      ArrayExpression(node) {
        // Only check if this might be a class array (heuristic: parent is JSX or has class-related context)
        for (const element of node.elements) {
          if (element && element.type === AST_NODE_TYPES.Literal && typeof element.value === "string") {
            checkStringForTokens(element.value, element);
          }
        }
      },
    };
  },
});
