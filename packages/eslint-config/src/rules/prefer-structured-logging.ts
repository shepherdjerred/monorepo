import { AST_NODE_TYPES, ESLintUtils } from "@typescript-eslint/utils";

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://github.com/shepherdjerred/share/blob/main/packages/eslint-config/src/rules/${name}.ts`,
);

const CONSOLE_METHODS = new Set(["log", "error", "warn", "info", "debug", "trace"]);

export const preferStructuredLogging = createRule({
  name: "prefer-structured-logging",
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Prefer structured logging with a logger over console methods for better log management and consistency.",
    },
    messages: {
      preferLogger:
        'Use a structured logger instead of console.{{method}}(). Example: const logger = createLogger("{{suggestedName}}"); logger.{{logMethod}}(...)',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type === AST_NODE_TYPES.MemberExpression &&
          node.callee.object.type === AST_NODE_TYPES.Identifier &&
          node.callee.object.name === "console" &&
          node.callee.property.type === AST_NODE_TYPES.Identifier &&
          CONSOLE_METHODS.has(node.callee.property.name)
        ) {
          const method = node.callee.property.name;

          const filename = context.filename;
          const pathParts = filename.split("/");
          const fileBasename = pathParts[pathParts.length - 1] ?? "app";
          const suggestedName = fileBasename.replace(/\.tsx?$/, "").replace(/\.test$/, "");

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
