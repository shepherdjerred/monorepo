import { AST_NODE_TYPES, ESLintUtils } from "@typescript-eslint/utils";
import type { TSESTree } from "@typescript-eslint/utils";

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://github.com/shepherdjerred/homelab/blob/main/eslint-rules/${name}.ts`,
);

export const noFunctionOverloads = createRule({
  name: "no-function-overloads",
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow function overloads. Use conditional types, union types, or optional parameters instead of multiple function signatures.",
    },
    messages: {
      functionOverload:
        "Function overloads are not allowed. Use conditional types instead. Example: Replace overloads with a single signature using conditional return types like `Promise<T extends SomeType ? ReturnTypeA : ReturnTypeB>`, or use union types for simpler cases.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    // Track function declarations by name per scope
    // Key: scope node (or "module" for top-level), Value: Map of function names to declarations
    const scopeStack: (TSESTree.Node | "module")[] = ["module"];
    const functionDeclarationsByScope = new Map<
      TSESTree.Node | "module",
      Map<string, (TSESTree.FunctionDeclaration | TSESTree.TSDeclareFunction)[]>
    >();

    function getCurrentScope(): TSESTree.Node | "module" {
      return scopeStack[scopeStack.length - 1] ?? "module";
    }

    function trackFunction(funcDecl: TSESTree.FunctionDeclaration | TSESTree.TSDeclareFunction): void {
      if (!funcDecl.id) {
        return;
      }

      const currentScope = getCurrentScope();
      const functionName = funcDecl.id.name;

      if (!functionDeclarationsByScope.has(currentScope)) {
        functionDeclarationsByScope.set(currentScope, new Map());
      }

      const scopeFunctions = functionDeclarationsByScope.get(currentScope);
      if (!scopeFunctions) {
        return;
      }
      const declarations = scopeFunctions.get(functionName) ?? [];
      declarations.push(funcDecl);
      scopeFunctions.set(functionName, declarations);
    }

    return {
      // Enter new scopes - functions create their own scope for nested functions
      FunctionDeclaration(node: TSESTree.FunctionDeclaration) {
        // Track this function in the current scope BEFORE entering its body
        trackFunction(node);
        // Now enter the function's body as a new scope
        scopeStack.push(node);
      },
      "FunctionDeclaration:exit"() {
        scopeStack.pop();
      },
      FunctionExpression(node: TSESTree.FunctionExpression) {
        scopeStack.push(node);
      },
      "FunctionExpression:exit"() {
        scopeStack.pop();
      },
      ArrowFunctionExpression(node: TSESTree.ArrowFunctionExpression) {
        scopeStack.push(node);
      },
      "ArrowFunctionExpression:exit"() {
        scopeStack.pop();
      },

      ExportNamedDeclaration(node: TSESTree.ExportNamedDeclaration) {
        if (node.declaration?.type === AST_NODE_TYPES.FunctionDeclaration) {
          trackFunction(node.declaration);
        } else if (node.declaration?.type === AST_NODE_TYPES.TSDeclareFunction) {
          trackFunction(node.declaration);
        }
      },
      TSDeclareFunction(node: TSESTree.TSDeclareFunction) {
        trackFunction(node);
      },

      "Program:exit"() {
        // Check for overloads in each scope
        const allScopes = Array.from(functionDeclarationsByScope.values());
        for (const scopeFunctions of allScopes) {
          const allFunctionGroups = Array.from(scopeFunctions.values());
          for (const declarations of allFunctionGroups) {
            // Deduplicate by node reference
            const seen = new WeakSet<TSESTree.FunctionDeclaration | TSESTree.TSDeclareFunction>();
            const uniqueDeclarations = declarations.filter((decl) => {
              if (seen.has(decl)) {
                return false;
              }
              seen.add(decl);
              return true;
            });

            if (uniqueDeclarations.length > 1) {
              // Found multiple declarations with the same name in the same scope
              for (const decl of uniqueDeclarations) {
                context.report({
                  node: decl,
                  messageId: "functionOverload",
                });
              }
            }
          }
        }
      },
    };
  },
});
