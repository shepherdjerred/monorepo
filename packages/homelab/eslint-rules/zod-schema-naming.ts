import type { TSESTree } from "@typescript-eslint/utils";
import { ESLintUtils } from "@typescript-eslint/utils";

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://github.com/shepherdjerred/homelab/blob/main/eslint-rules/${name}.ts`,
);

export const zodSchemaNaming = createRule({
  name: "zod-schema-naming",
  meta: {
    type: "suggestion",
    docs: {
      description: "Enforce PascalCase naming for Zod schema variables",
    },
    messages: {
      zodSchemaPascalCase:
        "Zod schema variables should use PascalCase naming convention. Found '{{name}}', expected PascalCase.",
      nonZodSchemaCamelCase:
        "Non-Zod variables ending with 'Schema' should use camelCase naming convention. Found '{{name}}', expected camelCase.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();

    function isPascalCase(name: string): boolean {
      return /^[A-Z][a-zA-Z0-9]*$/.test(name);
    }

    function isCamelCase(name: string): boolean {
      return /^[a-z][a-zA-Z0-9]*$/.test(name);
    }

    function isZodType(node: TSESTree.Node): boolean {
      try {
        const tsNode = services.esTreeNodeToTSNodeMap.get(node);
        const type = checker.getTypeAtLocation(tsNode);
        const typeString = checker.typeToString(type);

        // Check if the type is a Zod type
        return (
          typeString.includes("Zod") ||
          typeString.includes("ZodType") ||
          typeString.includes("ZodString") ||
          typeString.includes("ZodNumber") ||
          typeString.includes("ZodBoolean") ||
          typeString.includes("ZodArray") ||
          typeString.includes("ZodObject") ||
          typeString.includes("ZodRecord") ||
          typeString.includes("ZodUnion") ||
          typeString.includes("ZodLazy")
        );
      } catch {
        return false;
      }
    }

    return {
      VariableDeclarator(node) {
        if (
          node.id.type === "Identifier" &&
          node.init &&
          node.parent?.type === "VariableDeclaration" &&
          node.parent.kind === "const"
        ) {
          const varName = node.id.name;

          // Only check variables ending with "Schema"
          if (varName.endsWith("Schema")) {
            const isZod = isZodType(node.init);

            if (isZod && !isPascalCase(varName)) {
              // Zod schemas must be PascalCase
              context.report({
                node: node.id,
                messageId: "zodSchemaPascalCase",
                data: {
                  name: varName,
                },
              });
            } else if (!isZod && !isCamelCase(varName)) {
              // Non-Zod Schema variables must be camelCase
              context.report({
                node: node.id,
                messageId: "nonZodSchemaCamelCase",
                data: {
                  name: varName,
                },
              });
            }
          }
        }
      },
    };
  },
});
