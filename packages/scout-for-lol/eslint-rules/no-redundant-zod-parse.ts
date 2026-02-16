import { AST_NODE_TYPES, ESLintUtils, type TSESTree } from "@typescript-eslint/utils";

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://github.com/shepherdjerred/homelab/blob/main/eslint-rules/${name}.ts`,
);

export const noRedundantZodParse = createRule({
  name: "no-redundant-zod-parse",
  meta: {
    type: "problem",
    docs: {
      description: "Disallow parsing values with Zod when the type is already known and matches the schema output",
    },
    messages: {
      redundantParse:
        "Redundant Zod parse: the value '{{valueName}}' already has type '{{valueType}}' which matches the schema output. Zod validation is for unknown/untrusted data.",
    },
    schema: [],
    hasSuggestions: false,
  },
  defaultOptions: [],
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();

    function isZodSchema(node: TSESTree.Node): boolean {
      try {
        const tsNode = services.esTreeNodeToTSNodeMap.get(node);
        const type = checker.getTypeAtLocation(tsNode);
        const typeString = checker.typeToString(type);

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
          typeString.includes("ZodLazy") ||
          typeString.includes("ZodLiteral") ||
          typeString.includes("ZodEnum") ||
          typeString.includes("ZodNativeEnum")
        );
      } catch {
        return false;
      }
    }

    function getValueName(node: TSESTree.Node): string {
      if (node.type === AST_NODE_TYPES.Identifier) {
        return node.name;
      }
      return context.sourceCode.getText(node);
    }

    function isUnknownOrAny(typeString: string): boolean {
      return typeString === "unknown" || typeString === "any";
    }

    function isInSafeParseConditional(
      parseCallNode: TSESTree.CallExpression,
      schemaNode: TSESTree.Node,
      argument: TSESTree.Node,
    ): boolean {
      // Check if this parse call is inside a conditional that checks safeParse().success
      // Pattern: safeParse(x).success ? [parse(x)] : []

      let parent: TSESTree.Node | undefined = parseCallNode.parent;

      // Look up the tree to find a ConditionalExpression
      while (parent !== undefined) {
        if (parent.type === AST_NODE_TYPES.ConditionalExpression) {
          const test = parent.test;

          // Check if the test is a .success member access
          if (
            test.type === AST_NODE_TYPES.MemberExpression &&
            test.property.type === AST_NODE_TYPES.Identifier &&
            test.property.name === "success"
          ) {
            // Check if the object is a safeParse call
            if (
              test.object.type === AST_NODE_TYPES.CallExpression &&
              test.object.callee.type === AST_NODE_TYPES.MemberExpression &&
              test.object.callee.property.type === AST_NODE_TYPES.Identifier &&
              test.object.callee.property.name === "safeParse"
            ) {
              // Check if it's the same schema
              const safeParseSchema = test.object.callee.object;
              const safeParseArg = test.object.arguments[0];

              // Compare schema and argument
              const isSameSchema =
                context.sourceCode.getText(safeParseSchema) === context.sourceCode.getText(schemaNode);
              const isSameArg =
                safeParseArg !== undefined &&
                context.sourceCode.getText(safeParseArg) === context.sourceCode.getText(argument);

              // Early return to reduce nesting depth
              return isSameSchema && isSameArg;
            }
          }
        }
        parent = parent.parent;
      }

      return false;
    }

    return {
      CallExpression(node) {
        // Check if this is a .parse() or .safeParse() call
        if (
          node.callee.type === AST_NODE_TYPES.MemberExpression &&
          node.callee.property.type === AST_NODE_TYPES.Identifier &&
          (node.callee.property.name === "parse" || node.callee.property.name === "safeParse") &&
          node.arguments.length > 0
        ) {
          const schemaNode = node.callee.object;
          const argument = node.arguments[0];

          // TypeScript guard - argument should exist due to length check above
          if (!argument) {
            return;
          }

          // Check if the callee is a Zod schema
          if (!isZodSchema(schemaNode)) {
            return;
          }

          // Skip if this is only a safeParse call (we only want to check parse calls)
          if (node.callee.property.name === "safeParse") {
            return;
          }

          try {
            // Get the input argument's type
            const argTsNode = services.esTreeNodeToTSNodeMap.get(argument);
            const argType = checker.getTypeAtLocation(argTsNode);
            const argTypeString = checker.typeToString(argType);

            // Skip if the argument is unknown or any - those SHOULD be validated
            if (isUnknownOrAny(argTypeString)) {
              return;
            }

            // Get the return type of the entire parse() call expression
            const parseCallTsNode = services.esTreeNodeToTSNodeMap.get(node);
            const parseReturnType = checker.getTypeAtLocation(parseCallTsNode);
            const parseReturnTypeString = checker.typeToString(parseReturnType);

            // If the argument type already matches the parse return type, it's redundant
            // This works for both primitive types and branded types
            if (argTypeString === parseReturnTypeString) {
              // Don't flag if this parse is part of a safeParse check pattern
              // Pattern: safeParse(x).success ? [parse(x)] : []
              if (isInSafeParseConditional(node, schemaNode, argument)) {
                return;
              }

              context.report({
                node: node.callee.property,
                messageId: "redundantParse",
                data: {
                  valueName: getValueName(argument),
                  valueType: argTypeString,
                },
              });
            }
          } catch {
            // If we can't analyze the types, don't report
            return;
          }
        }
      },
    };
  },
});
