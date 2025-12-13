/**
 * ESLint rule to detect when date-fns should be used instead of manual date math
 *
 * Flags patterns where date-fns functions would improve code clarity:
 * - Manual getTime() arithmetic (use differenceInDays, differenceInHours, etc.)
 * - Manual relative time formatting (use formatDistance, formatDistanceToNow)
 * - Manual date range iteration (use eachDayOfInterval, startOfDay, endOfDay)
 * - Manual formatting (use format instead of toLocaleString)
 * - Custom date formatting helpers that duplicate date-fns functionality
 */

import type { TSESTree } from "@typescript-eslint/utils";
import { ESLintUtils } from "@typescript-eslint/utils";

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://github.com/shepherdjerred/share/tree/main/packages/eslint-config/src/rules/${name}.ts`,
);

export const preferDateFns = createRule({
  name: "prefer-date-fns",
  meta: {
    type: "suggestion",
    docs: {
      description: "Prefer date-fns functions over manual Date arithmetic and formatting",
    },
    schema: [],
    messages: {
      getTimeMath:
        "Use date-fns (differenceInDays, differenceInHours, getUnixTime, etc.) instead of manual getTime() arithmetic",
      setDateMutation:
        "Use date-fns (addDays, subDays, startOfDay, etc.) instead of mutating Date with setDate/setUTCDate/setUTCHours",
      timeAgoFormatting:
        "Use date-fns (formatDistance, formatDistanceToNow) instead of manual relative time formatting with if/else branches",
      dateRangeIteration:
        "Use date-fns (eachDayOfInterval, startOfDay, endOfDay) instead of while loops with manual day iteration",
      toLocaleStringFormatting:
        "Use date-fns format() instead of toLocaleString/toLocaleDateString for deterministic formatting",
      isoStringReplace: "Use date-fns format() instead of toISOString().replace() for file-safe timestamps",
      customDateHelper:
        "Use date-fns functions instead of custom date formatting/calculation helpers (e.g., format, differenceInMinutes, differenceInHours, etc.)",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      // Detect: date.getTime() - otherDate.getTime(), then divide by 1000 * 60 * 60 * 24
      // Also detect: date.getTime() / 1000 (Unix timestamp conversion)
      BinaryExpression(node: TSESTree.BinaryExpression) {
        // Pattern 1: Division by millisecond constants like (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24)
        if (node.operator === "/" && node.right.type === "BinaryExpression" && node.right.operator === "*") {
          const left = node.left;

          // Check if left side is a subtraction involving getTime() or Date.now()
          if (left.type === "BinaryExpression" && left.operator === "-") {
            const hasGetTimeOrDateNow =
              (left.left.type === "CallExpression" &&
                ((left.left.callee.type === "MemberExpression" &&
                  left.left.callee.property.type === "Identifier" &&
                  (left.left.callee.property.name === "getTime" ||
                    (left.left.callee.property.name === "now" &&
                      left.left.callee.object.type === "Identifier" &&
                      left.left.callee.object.name === "Date"))) ||
                  (left.left.callee.type === "Identifier" && left.left.callee.name === "Date"))) ||
              (left.right.type === "CallExpression" &&
                left.right.callee.type === "MemberExpression" &&
                left.right.callee.property.type === "Identifier" &&
                left.right.callee.property.name === "getTime");

            if (hasGetTimeOrDateNow) {
              context.report({
                node,
                messageId: "getTimeMath",
              });
            }
          }
        }

        // Pattern 2: Division by 1000 for Unix timestamp (getTime() / 1000)
        if (
          node.operator === "/" &&
          node.right.type === "Literal" &&
          node.right.value === 1000 &&
          node.left.type === "CallExpression" &&
          node.left.callee.type === "MemberExpression" &&
          node.left.callee.property.type === "Identifier" &&
          node.left.callee.property.name === "getTime"
        ) {
          context.report({
            node,
            messageId: "getTimeMath",
          });
        }
      },

      // Detect: date.setDate(...), date.setUTCDate(...), date.setUTCHours(...)
      CallExpression(node: TSESTree.CallExpression) {
        if (node.callee.type === "MemberExpression" && node.callee.property.type === "Identifier") {
          const propertyName = node.callee.property.name;
          const methodNames = [
            "setDate",
            "setUTCDate",
            "setUTCHours",
            "setUTCMinutes",
            "setUTCSeconds",
            "setHours",
            "setMinutes",
            "setSeconds",
          ];

          if (methodNames.includes(propertyName)) {
            context.report({
              node,
              messageId: "setDateMutation",
            });
          }
        }

        // Detect: toLocaleString, toLocaleDateString
        if (node.callee.type === "MemberExpression" && node.callee.property.type === "Identifier") {
          const propertyName = node.callee.property.name;
          if (propertyName === "toLocaleString" || propertyName === "toLocaleDateString") {
            context.report({
              node,
              messageId: "toLocaleStringFormatting",
            });
          }
        }

        // Detect: toISOString().replace(...)
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.property.type === "Identifier" &&
          node.callee.property.name === "replace" &&
          node.callee.object.type === "CallExpression" &&
          node.callee.object.callee.type === "MemberExpression" &&
          node.callee.object.callee.property.type === "Identifier" &&
          node.callee.object.callee.property.name === "toISOString"
        ) {
          context.report({
            node,
            messageId: "isoStringReplace",
          });
        }
      },

      // Detect: while (current <= end) with date mutations inside
      WhileStatement(node: TSESTree.WhileStatement) {
        // Check if condition involves date comparison
        if (node.test.type === "BinaryExpression") {
          const test = node.test as TSESTree.BinaryExpression;
          if (
            (test.operator === "<=" || test.operator === "<" || test.operator === ">=") &&
            (test.left.type === "Identifier" || test.right.type === "Identifier")
          ) {
            // Check if body contains setUTCDate or similar mutations
            const hasDateMutation = hasDateMutationInBody(node.body);
            if (hasDateMutation) {
              context.report({
                node,
                messageId: "dateRangeIteration",
              });
            }
          }
        }
      },

      // Detect: if (diff < 60000) followed by time-ago branches
      IfStatement(node: TSESTree.IfStatement) {
        // Check for pattern: if (diff < 60000) { return "X ago"; }
        if (isTimeAgoPattern(node)) {
          context.report({
            node,
            messageId: "timeAgoFormatting",
          });
        }
      },

      // Detect: Custom date helper functions (formatTimeAgo, daysUntil, formatHumanDateTime, etc.)
      FunctionDeclaration(node: TSESTree.FunctionDeclaration) {
        if (node.id && isCustomDateHelperName(node.id.name)) {
          // Check if function body contains manual date calculations
          if (containsManualDateMath(node.body)) {
            context.report({
              node,
              messageId: "customDateHelper",
            });
          }
        }
      },
    };
  },
});

/**
 * Check if a function name suggests it's a custom date helper
 */
function isCustomDateHelperName(name: string): boolean {
  const dateFunctionPatterns = [
    /format.*(time|date|timestamp)/i,
    /.*TimeAgo/i,
    /daysUntil/i,
    /hoursUntil/i,
    /minutesUntil/i,
    /.*DaysBetween/i,
    /calculateDays/i,
    /getDays/i,
    /getHours/i,
    /getMinutes/i,
  ];

  return dateFunctionPatterns.some((pattern) => pattern.test(name));
}

/**
 * Check if a statement body contains date mutations like setDate, setUTCDate, etc.
 */
function hasDateMutationInBody(body: TSESTree.Statement): boolean {
  const visitor = {
    found: false,
  };
  const visited = new WeakSet<object>();

  function traverse(node: TSESTree.Node | undefined) {
    if (!node || visited.has(node)) return;
    visited.add(node);

    if (node.type === "CallExpression") {
      if (node.callee.type === "MemberExpression" && node.callee.property.type === "Identifier") {
        const methodNames = ["setDate", "setUTCDate", "setUTCHours", "setUTCMinutes", "setUTCSeconds"];
        if (methodNames.includes(node.callee.property.name)) {
          visitor.found = true;
        }
      }
    }

    // Recursively traverse child nodes
    for (const key in node) {
      const value = (node as unknown as Record<string, unknown>)[key];
      if (value && typeof value === "object") {
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item && typeof item === "object" && "type" in item) {
              traverse(item as TSESTree.Node);
            }
          }
        } else if ("type" in value) {
          traverse(value as TSESTree.Node);
        }
      }
    }
  }

  traverse(body);
  return visitor.found;
}

/**
 * Check if function body contains manual date math (getTime division, if/else for time-ago, etc.)
 */
function containsManualDateMath(body: TSESTree.BlockStatement | undefined): boolean {
  if (!body) return false;

  let found = false;
  const visited = new WeakSet<object>();

  function traverse(node: TSESTree.Node | undefined) {
    if (!node || found || visited.has(node)) return;
    visited.add(node);

    // Check for getTime() arithmetic patterns
    if (node.type === "BinaryExpression") {
      const binExpr = node as TSESTree.BinaryExpression;
      if (binExpr.operator === "/" && binExpr.right.type === "BinaryExpression") {
        // Pattern: (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24)
        found = true;
        return;
      }
    }

    // Check for if/else chains checking milliseconds
    if (node.type === "IfStatement") {
      const ifStmt = node as TSESTree.IfStatement;
      if (ifStmt.test.type === "BinaryExpression" && (ifStmt.test.operator === "<" || ifStmt.test.operator === ">")) {
        const test = ifStmt.test as TSESTree.BinaryExpression;
        // Check if comparing to millisecond constants (60000, 3600000, 86400000)
        const hasLiteralMs =
          (test.left.type === "Literal" && typeof test.left.value === "number") ||
          (test.right.type === "Literal" && typeof test.right.value === "number");

        if (hasLiteralMs) {
          found = true;
          return;
        }
      }
    }

    // Recursively traverse child nodes
    for (const key in node) {
      const value = (node as unknown as Record<string, unknown>)[key];
      if (value && typeof value === "object") {
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item && typeof item === "object" && "type" in item) {
              traverse(item as TSESTree.Node);
            }
          }
        } else if ("type" in value && value.type) {
          traverse(value as TSESTree.Node);
        }
      }
    }
  }

  traverse(body);
  return found;
}

/**
 * Check for time-ago pattern: multiple if branches comparing milliseconds to constants
 */
function isTimeAgoPattern(node: TSESTree.IfStatement): boolean {
  let current: TSESTree.IfStatement | TSESTree.Statement | null = node;
  let branchCount = 0;

  while (current && current.type === "IfStatement") {
    branchCount++;

    // Check if test is comparing a diff variable to ms constants
    if (current.test.type === "BinaryExpression" && (current.test.operator === "<" || current.test.operator === ">")) {
      const test = current.test as TSESTree.BinaryExpression;
      const isCompareToMs =
        (test.right.type === "Literal" && typeof test.right.value === "number") ||
        (test.left.type === "Literal" && typeof test.left.value === "number");

      if (!isCompareToMs) {
        return false;
      }
    }

    current = current.alternate;
  }

  // If we have 2+ branches with ms comparisons, it's likely time-ago formatting
  return branchCount >= 2;
}
