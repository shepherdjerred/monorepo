import { AST_NODE_TYPES, ESLintUtils } from "@typescript-eslint/utils";
import type { TSESTree } from "@typescript-eslint/utils";

const createRule = ESLintUtils.RuleCreator(
  (name) =>
    `https://github.com/shepherdjerred/share/tree/main/packages/eslint-config/src/rules/${name}.ts`,
);

type MessageIds =
  | "useEffectFound"
  | "useEffectWithDeps"
  | "useEffectWithoutDeps"
  | "useEffectTransformData"
  | "useEffectEventHandler"
  | "useEffectStateSync";

export const noUseEffect = createRule<[], MessageIds>({
  name: "no-use-effect",
  meta: {
    type: "problem",
    docs: {
      description:
        "Avoid useEffect in React components. Most useEffect calls can be removed or replaced with better alternatives like useMemo, event handlers, or component key remounting. See React docs: https://react.dev/learn/you-might-not-need-an-effect",
    },
    messages: {
      useEffectFound:
        "Avoid useEffect - transform data at component render time or use event handlers instead. See https://react.dev/learn/you-might-not-need-an-effect",
      useEffectWithDeps:
        "useEffect with dependencies is often unnecessary. Consider: (1) Calculate values during rendering if based on props/state, (2) Move logic to event handlers if triggered by user interaction, (3) Use useMemo if expensive computation, (4) Use key prop to reset state if based on prop changes.",
      useEffectWithoutDeps:
        "useEffect without dependencies runs every render - likely a bug. Consider: (1) Extract to top-level code if needed once per app load, (2) Move to event handler if response to user action, (3) Use useSyncExternalStore for external subscriptions.",
      useEffectTransformData:
        "useEffect is being used to transform data. Calculate values directly during rendering instead: const filtered = todos.filter(...) instead of useEffect(() => setFiltered(...)).",
      useEffectEventHandler:
        "useEffect is being used for event-specific logic. Move this to the appropriate event handler instead - it only needs to run when user takes action, not on every prop change.",
      useEffectStateSync:
        "useEffect is being used to synchronize state based on props. Use the key prop to reset state when prop changes, or calculate derived values during rendering instead.",
    },
    fixable: "code",
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node: TSESTree.CallExpression) {
        // Check if this is a useEffect call
        if (
          node.callee.type === AST_NODE_TYPES.Identifier &&
          node.callee.name === "useEffect"
        ) {
          const sourceCode = context.sourceCode;
          const effectArg = node.arguments[0];
          const depsArg = node.arguments[1];

          let suggestion:
            | "useEffectWithDeps"
            | "useEffectWithoutDeps"
            | "useEffectTransformData"
            | "useEffectEventHandler"
            | "useEffectStateSync" = "useEffectWithDeps";

          // Heuristic: check if there's no dependency array
          if (!depsArg) {
            suggestion = "useEffectWithoutDeps";
          } else if (
            depsArg.type === AST_NODE_TYPES.ArrayExpression &&
            depsArg.elements.length === 0
          ) {
            // Empty dependency array - likely app initialization or subscription
            suggestion = "useEffectWithoutDeps";
          } else {
            // With dependencies - check if it looks like data transformation
            const effectCode =
              effectArg && sourceCode.getText(effectArg).toLowerCase();

            if (
              effectCode &&
              (effectCode.includes("setstate") ||
                effectCode.includes("setvisible") ||
                effectCode.includes("setfilter") ||
                effectCode.includes("setdata") ||
                effectCode.includes("filter") ||
                effectCode.includes("map"))
            ) {
              suggestion = "useEffectTransformData";
            } else if (
              effectCode &&
              (effectCode.includes("post(") ||
                effectCode.includes("fetch(") ||
                effectCode.includes("addeventlistener") ||
                effectCode.includes("subscribe"))
            ) {
              suggestion = "useEffectEventHandler";
            } else if (
              effectCode &&
              (effectCode.includes("setcomment") ||
                effectCode.includes("reset"))
            ) {
              suggestion = "useEffectStateSync";
            }
          }

          context.report({
            node,
            messageId: suggestion,
            fix(fixer) {
              // Provide a comment removal fix - this removes the useEffect call
              // but doesn't auto-fix the logic (too complex to determine the right fix)
              return fixer.remove(node);
            },
          });
        }
      },
    };
  },
});
