import { ESLintUtils, AST_NODE_TYPES } from "@typescript-eslint/utils";

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://github.com/shepherdjerred/homelab/blob/main/eslint-rules/${name}.ts`,
);

/**
 * ESLint rule to enforce Raw* naming convention for types representing external/unvalidated data.
 *
 * Types representing data from external sources (APIs, user input, etc.) should use the "Raw"
 * prefix (e.g., RawMatch, RawParticipant) instead of the "Dto" suffix (e.g., MatchDto, ParticipantDto).
 *
 * This helps distinguish between:
 * - Raw data from external sources that needs validation (Raw* prefix)
 * - Internal domain types that have been validated (no special prefix)
 */
export const noDtoNaming = createRule({
  name: "no-dto-naming",
  meta: {
    type: "suggestion",
    docs: {
      description: "Enforce Raw* prefix instead of *Dto suffix for types representing external/unvalidated data",
    },
    messages: {
      useDtoSuffix:
        "Type '{{name}}' uses *Dto suffix. Use Raw* prefix instead for external/unvalidated data types (e.g., '{{suggested}}'). See CLAUDE.md for naming conventions.",
      schemaDtoSuffix:
        "Schema '{{name}}' uses *DtoSchema suffix. Use Raw*Schema instead (e.g., '{{suggested}}'). See CLAUDE.md for naming conventions.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    function checkName(name: string, node: Parameters<typeof context.report>[0]["node"]) {
      // Check for *Dto type names (e.g., MatchDto, ParticipantDto)
      if (name.endsWith("Dto") && !name.endsWith("DtoSchema")) {
        const baseName = name.slice(0, -3); // Remove "Dto"
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

      // Check for *DtoSchema schema names (e.g., MatchDtoSchema)
      if (name.endsWith("DtoSchema")) {
        const baseName = name.slice(0, -9); // Remove "DtoSchema"
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
      // Check type alias declarations (e.g., type MatchDto = ...)
      TSTypeAliasDeclaration(node) {
        checkName(node.id.name, node.id);
      },

      // Check interface declarations (e.g., interface MatchDto { ... })
      TSInterfaceDeclaration(node) {
        checkName(node.id.name, node.id);
      },

      // Check const declarations for schema variables (e.g., const MatchDtoSchema = ...)
      VariableDeclarator(node) {
        if (node.id.type === AST_NODE_TYPES.Identifier && node.parent.kind === "const") {
          checkName(node.id.name, node.id);
        }
      },
    };
  },
});
