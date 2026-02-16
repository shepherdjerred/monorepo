import { AST_NODE_TYPES, ESLintUtils } from "@typescript-eslint/utils";
import type { TSESTree } from "@typescript-eslint/utils";

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://github.com/shepherdjerred/share/blob/main/packages/eslint-config/src/rules/${name}.ts`,
);

/**
 * Enforce Raw* prefix instead of *Dto suffix for types representing external/unvalidated data.
 */
export const noDtoNaming = createRule({
  name: "no-dto-naming",
  meta: {
    type: "suggestion",
    docs: {
      description: "Enforce Raw* prefix instead of *Dto suffix for external/unvalidated data type names",
    },
    messages: {
      useDtoSuffix:
        "Type '{{name}}' uses *Dto suffix. Use Raw* prefix instead (for example '{{suggested}}').",
      schemaDtoSuffix:
        "Schema '{{name}}' uses *DtoSchema suffix. Use Raw*Schema instead (for example '{{suggested}}').",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    function checkName(name: string, node: TSESTree.Node) {
      if (name.endsWith("Dto") && !name.endsWith("DtoSchema")) {
        const baseName = name.slice(0, -3);
        const suggested = `Raw${baseName}`;
        context.report({
          node,
          messageId: "useDtoSuffix",
          data: {
            name,
            suggested,
          },
        });
      }

      if (name.endsWith("DtoSchema")) {
        const baseName = name.slice(0, -9);
        const suggested = `Raw${baseName}Schema`;
        context.report({
          node,
          messageId: "schemaDtoSuffix",
          data: {
            name,
            suggested,
          },
        });
      }
    }

    return {
      TSTypeAliasDeclaration(node) {
        checkName(node.id.name, node.id);
      },
      TSInterfaceDeclaration(node) {
        checkName(node.id.name, node.id);
      },
      VariableDeclarator(node) {
        if (node.id.type === AST_NODE_TYPES.Identifier && node.parent.kind === "const") {
          checkName(node.id.name, node.id);
        }
      },
    };
  },
});
