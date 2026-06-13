import { AST_NODE_TYPES, ESLintUtils } from "@typescript-eslint/utils";
import type { TSESTree } from "@typescript-eslint/utils";

const createRule = ESLintUtils.RuleCreator(
  (name) =>
    `https://github.com/shepherdjerred/monorepo/tree/main/packages/eslint-config/src/rules/${name}.ts`,
);

const CONTAINER_METHODS = new Set(["addContainer", "addInitContainer"]);

/**
 * Wrapper helpers whose first argument is the container props object. The rule
 * looks through these to find the props literal.
 */
const PROPS_WRAPPERS = new Set([
  "withCommonProps",
  "withCommonLinuxServerProps",
]);

function hasResourcesProperty(obj: TSESTree.ObjectExpression): boolean {
  return obj.properties.some(
    (prop) =>
      prop.type === AST_NODE_TYPES.Property &&
      ((prop.key.type === AST_NODE_TYPES.Identifier &&
        prop.key.name === "resources") ||
        (prop.key.type === AST_NODE_TYPES.Literal &&
          prop.key.value === "resources")),
  );
}

function hasSpreadElement(obj: TSESTree.ObjectExpression): boolean {
  return obj.properties.some(
    (prop) => prop.type === AST_NODE_TYPES.SpreadElement,
  );
}

/**
 * Resolve the container-props object literal from the first argument of an
 * addContainer/addInitContainer call: either a direct object literal, or one
 * wrapped in a known props helper like withCommonProps({...}).
 */
function resolvePropsObject(
  arg: TSESTree.CallExpressionArgument | undefined,
): TSESTree.ObjectExpression | undefined {
  if (arg == null) {
    return undefined;
  }
  if (arg.type === AST_NODE_TYPES.ObjectExpression) {
    return arg;
  }
  if (
    arg.type === AST_NODE_TYPES.CallExpression &&
    arg.callee.type === AST_NODE_TYPES.Identifier &&
    PROPS_WRAPPERS.has(arg.callee.name)
  ) {
    const inner = arg.arguments[0];
    if (inner?.type === AST_NODE_TYPES.ObjectExpression) {
      return inner;
    }
  }
  return undefined;
}

export const requireContainerResources = createRule({
  name: "require-container-resources",
  meta: {
    type: "problem",
    docs: {
      description:
        "Require an explicit `resources` property on every cdk8s-plus addContainer/addInitContainer call. " +
        "Omitting it silently inherits cdk8s-plus defaults (1 CPU / 512Mi requests), while helpers that " +
        "inject an empty object silently produce BestEffort pods. Write `resources: {}` to opt into " +
        "BestEffort visibly, or set real requests/limits.",
    },
    messages: {
      missingResources:
        "Container props must declare `resources` explicitly. Without it, cdk8s-plus silently applies " +
        "a 1 CPU / 512Mi request default. Set real requests/limits, or write `resources: {}` to make " +
        "a BestEffort (no requests) pod a visible, reviewable decision.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node: TSESTree.CallExpression) {
        if (
          node.callee.type !== AST_NODE_TYPES.MemberExpression ||
          node.callee.property.type !== AST_NODE_TYPES.Identifier ||
          !CONTAINER_METHODS.has(node.callee.property.name)
        ) {
          return;
        }

        const props = resolvePropsObject(node.arguments[0]);
        if (props == null) {
          // Not statically analyzable (identifier, unknown wrapper, etc.) — skip.
          return;
        }
        if (hasResourcesProperty(props)) {
          return;
        }
        if (hasSpreadElement(props)) {
          // A spread may carry `resources`; can't prove absence statically.
          return;
        }

        context.report({
          node: props,
          messageId: "missingResources",
        });
      },
    };
  },
});
