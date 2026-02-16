import { AST_NODE_TYPES, ESLintUtils } from "@typescript-eslint/utils";

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://github.com/shepherdjerred/scout-for-lol/blob/main/eslint-rules/${name}.ts`,
);

const CONSOLE_METHODS = new Set(["log", "error", "warn", "info", "debug", "trace"]);

export const preferStructuredLogging = createRule({
  name: "prefer-structured-logging",
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Prefer structured logging with tslog over console.log/error/warn for better log management, file output, and log levels.",
    },
    messages: {
      preferLogger:
        'Use the structured logger instead of console.{{method}}(). Import { createLogger } from "./logger" and create a named logger for your module. Example: const logger = createLogger("{{suggestedName}}"); logger.{{logMethod}}(...)',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        // Check for console.log, console.error, etc.
        if (
          node.callee.type === AST_NODE_TYPES.MemberExpression &&
          node.callee.object.type === AST_NODE_TYPES.Identifier &&
          node.callee.object.name === "console" &&
          node.callee.property.type === AST_NODE_TYPES.Identifier &&
          CONSOLE_METHODS.has(node.callee.property.name)
        ) {
          const method = node.callee.property.name;

          // Extract module name from file path
          const filename = context.filename;
          const pathParts = filename.split("/");
          const fileBasename = pathParts[pathParts.length - 1] ?? "app";
          const suggestedName = fileBasename.replace(/\.tsx?$/, "").replace(/\.test$/, "");

          // Map console methods to logger methods
          const logMethodMap: Record<string, string> = {
            log: "info",
            error: "error",
            warn: "warn",
            info: "info",
            debug: "debug",
            trace: "trace",
          };

          context.report({
            node,
            messageId: "preferLogger",
            data: {
              method,
              suggestedName,
              logMethod: logMethodMap[method] ?? "info",
            },
          });
        }
      },
    };
  },
});
