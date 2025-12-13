import { AST_NODE_TYPES, ESLintUtils, type TSESTree } from "@typescript-eslint/utils";

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://github.com/shepherdjerred/share/tree/main/packages/eslint-config/src/rules/${name}.ts`,
);

type Options = [{ satoriPaths?: string[] }?];
type MessageIds =
  | "noClassNames"
  | "noImportedStyles"
  | "noDynamicJsx"
  | "noFontsInOptions"
  | "noExternalImages"
  | "noEventHandlers"
  | "noHtmlElements"
  | "elementWithoutDisplay";

export const satoriBestPractices = createRule<Options, MessageIds>({
  name: "satori-best-practices",
  meta: {
    type: "problem",
    docs: {
      description: "Enforce Satori best practices: inline styles, static JSX only, and proper font handling",
    },
    messages: {
      noClassNames:
        "Satori does not support CSS classes. Use inline styles instead. Components should use the 'style' prop with inline style objects.",
      noImportedStyles:
        "Satori does not support imported stylesheets or CSS modules. Use inline styles with the 'style' prop instead.",
      noDynamicJsx:
        "Satori components must be pure and stateless (no useState, useEffect, hooks). All JSX must be deterministic and static. Use data transformation outside the JSX if needed.",
      noFontsInOptions:
        "Fonts should be passed to satori() in the 'fonts' option as Buffers/ArrayBuffers with name, data, weight, and style. Do not rely on system fonts.",
      noExternalImages:
        "Avoid loading external images in Satori (requires extra I/O). Use base64-encoded image data URLs instead: src='data:image/png;base64,...' or pass images as Buffer.",
      noEventHandlers:
        "Satori components should not have event handlers (onClick, onChange, etc.). Satori renders to static SVG, not interactive components.",
      noHtmlElements:
        "Satori does not support this HTML element. Use supported elements: div, span, p, img, svg, button, etc. Avoid <input>, <form>, <script>, <style>, <link>.",
      elementWithoutDisplay:
        "Satori requires container elements with multiple children to have an explicit display property set to 'flex', 'contents', or 'none'. Add style={{display: 'flex'}} (or 'contents'/'none').",
    },
    schema: [
      {
        type: "object",
        properties: {
          satoriPaths: {
            type: "array",
            items: { type: "string" },
            description: "File paths that should be treated as Satori components",
          },
        },
        additionalProperties: false,
      },
    ],
  },
  defaultOptions: [{ satoriPaths: ["packages/report"] }],
  create(context) {
    const options = context.options[0] ?? {};
    const satoriPaths = options.satoriPaths ?? ["packages/report"];

    // Satori-unsupported elements that should never be used
    const unsupportedElements = new Set([
      "input",
      "form",
      "textarea",
      "select",
      "option",
      "script",
      "style",
      "link",
      "meta",
      "base",
      "title",
      "noscript",
    ]);

    function isSatoriComponent(): boolean {
      const filePath = context.filename;
      return satoriPaths.some((path) => filePath.includes(path));
    }

    function getStyleDisplayValue(node: TSESTree.JSXElement): string | null {
      const styleAttr = node.openingElement.attributes.find(
        (attr) =>
          attr.type === AST_NODE_TYPES.JSXAttribute &&
          attr.name.type === AST_NODE_TYPES.JSXIdentifier &&
          attr.name.name === "style",
      );

      if (!styleAttr || styleAttr.type !== AST_NODE_TYPES.JSXAttribute || !styleAttr.value) {
        return null;
      }

      // Handle inline style object: style={{ display: 'flex' }}
      if (
        styleAttr.value.type === AST_NODE_TYPES.JSXExpressionContainer &&
        styleAttr.value.expression.type === AST_NODE_TYPES.ObjectExpression
      ) {
        const displayProp = styleAttr.value.expression.properties.find(
          (prop) =>
            prop.type === AST_NODE_TYPES.Property &&
            ((prop.key.type === AST_NODE_TYPES.Identifier && prop.key.name === "display") ||
              (prop.key.type === AST_NODE_TYPES.Literal && prop.key.value === "display")),
        );

        if (
          displayProp &&
          displayProp.type === AST_NODE_TYPES.Property &&
          displayProp.value.type === AST_NODE_TYPES.Literal
        ) {
          return String(displayProp.value.value);
        }
      }

      return null;
    }

    function countJSXElementChildren(node: TSESTree.JSXElement): number {
      // Count only JSX elements (not text or expressions mixed with text)
      // Expressions mixed with text are inline and don't need layout control
      // Only *multiple JSX elements* need display: flex
      let elementCount = 0;
      let hasTextOrExpression = false;

      for (const child of node.children) {
        if (child.type === AST_NODE_TYPES.JSXElement || child.type === AST_NODE_TYPES.JSXFragment) {
          elementCount++;
        } else if (child.type === AST_NODE_TYPES.JSXText) {
          if (child.value.trim().length > 0) {
            hasTextOrExpression = true;
          }
        } else if (child.type === AST_NODE_TYPES.JSXExpressionContainer) {
          hasTextOrExpression = true;
        }
      }

      // Only count pure elements that are siblings
      // If there's text or expressions mixed in, this is inline content, not layout
      // Return elementCount only if we have multiple JSX elements and no mixed text/expressions
      if (hasTextOrExpression) {
        return elementCount;
      }
      return elementCount;
    }

    function checkJSXElement(node: TSESTree.JSXElement) {
      if (!isSatoriComponent()) {
        return;
      }

      // Check for unsupported HTML elements
      if (node.openingElement.name.type === AST_NODE_TYPES.JSXIdentifier) {
        const tagName = node.openingElement.name.name.toLowerCase();
        if (unsupportedElements.has(tagName)) {
          context.report({
            node: node.openingElement.name,
            messageId: "noHtmlElements",
          });
        }

        // Check for elements with multiple children without explicit display property
        // Satori requires all container elements to have display: flex, contents, or none
        const childCount = countJSXElementChildren(node);
        if (childCount > 1) {
          const display = getStyleDisplayValue(node);
          const validDisplays = new Set(["flex", "contents", "none"]);

          if (!display || !validDisplays.has(display)) {
            context.report({
              node: node.openingElement.name,
              messageId: "elementWithoutDisplay",
            });
          }
        }
      }

      // Check for className attribute
      node.openingElement.attributes.forEach((attr) => {
        if (
          attr.type === AST_NODE_TYPES.JSXAttribute &&
          attr.name.type === AST_NODE_TYPES.JSXIdentifier &&
          attr.name.name === "className"
        ) {
          context.report({
            node: attr,
            messageId: "noClassNames",
          });
        }

        // Check for event handlers
        if (
          attr.type === AST_NODE_TYPES.JSXAttribute &&
          attr.name.type === AST_NODE_TYPES.JSXIdentifier &&
          (attr.name.name.startsWith("on") ||
            ["onClick", "onChange", "onSubmit", "onFocus", "onBlur"].includes(attr.name.name))
        ) {
          context.report({
            node: attr,
            messageId: "noEventHandlers",
          });
        }

        // Check for image src attributes (warn about external URLs)
        if (
          attr.type === AST_NODE_TYPES.JSXAttribute &&
          attr.name.type === AST_NODE_TYPES.JSXIdentifier &&
          attr.name.name === "src"
        ) {
          const parentTag =
            node.openingElement.name.type === AST_NODE_TYPES.JSXIdentifier ? node.openingElement.name.name : null;

          if (parentTag === "img" && attr.value && attr.value.type === AST_NODE_TYPES.Literal) {
            const srcValue = String(attr.value.value);
            // Warn about external URLs (http://, https://, //) but allow data URLs and variables
            if (srcValue.startsWith("http://") || srcValue.startsWith("https://") || srcValue.startsWith("//")) {
              context.report({
                node: attr,
                messageId: "noExternalImages",
              });
            }
          }
        }
      });
    }

    function isLikelyHookCall(node: TSESTree.CallExpression): boolean {
      // Check if this looks like a React hook (starts with 'use' and is PascalCase or lowercase like useState)
      if (node.callee.type === AST_NODE_TYPES.Identifier) {
        const name = node.callee.name;
        // React hooks follow the pattern of 'use' prefix
        return name.startsWith("use") && (name.charAt(3).toUpperCase() === name.charAt(3) || name === "use");
      }

      // Also check for useXxx patterns from the callee
      if (node.callee.type === AST_NODE_TYPES.MemberExpression) {
        if (node.callee.property.type === AST_NODE_TYPES.Identifier) {
          const name = node.callee.property.name;
          return name.startsWith("use") && name.charAt(3).toUpperCase() === name.charAt(3);
        }
      }

      return false;
    }

    function checkJSXChild(node: TSESTree.JSXElement) {
      if (!isSatoriComponent()) {
        return;
      }

      // Check for dynamic expressions in JSX children
      node.children.forEach((child) => {
        if (child.type === AST_NODE_TYPES.JSXExpressionContainer) {
          const expression = child.expression;

          // Conditional expressions (ternary, logical) are okay - they're pure and deterministic
          if (
            expression.type === AST_NODE_TYPES.ConditionalExpression ||
            expression.type === AST_NODE_TYPES.LogicalExpression
          ) {
            // These are okay for conditional rendering
            return;
          }

          // Check for function calls - but only if they look like hooks
          if (expression.type === AST_NODE_TYPES.CallExpression) {
            if (isLikelyHookCall(expression)) {
              context.report({
                node: child,
                messageId: "noDynamicJsx",
              });
            }
            // Other function calls (like ts-pattern's match(), utility functions, etc.) are okay
          }
        }

        // Check for spread children
        if (child.type === AST_NODE_TYPES.JSXSpreadChild) {
          context.report({
            node: child,
            messageId: "noDynamicJsx",
          });
        }
      });
    }

    return {
      JSXElement(node) {
        checkJSXElement(node);
        checkJSXChild(node);
      },
      ImportDeclaration(node) {
        // Check for CSS/style imports in Satori files
        if (
          node.source.value.endsWith(".css") ||
          node.source.value.endsWith(".scss") ||
          node.source.value.includes(".module.")
        ) {
          // Only report if this file uses satori
          const sourceCode = context.sourceCode;
          const text = sourceCode.getText();

          if (text.includes('import satori from "satori"') || text.includes("from 'satori'")) {
            context.report({
              node,
              messageId: "noImportedStyles",
            });
          }
        }
      },
    };
  },
});
