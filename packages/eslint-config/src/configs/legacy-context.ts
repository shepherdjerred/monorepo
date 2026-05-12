import type { ESLint, Rule } from "eslint";

type PluginRules = NonNullable<ESLint.Plugin["rules"]>;

/**
 * ESLint 10 keeps some legacy methods off RuleContext. A few ecosystem plugins
 * still call them directly even after @eslint/compat rule wrapping, so provide
 * the old read-only accessors through a Proxy before invoking plugin rules.
 */
export function withLegacyContextMethods(plugin: ESLint.Plugin): ESLint.Plugin {
  const rules = plugin.rules;
  if (rules === undefined) {
    return plugin;
  }

  const wrappedRules: PluginRules = {};
  for (const [ruleName, rule] of Object.entries(rules)) {
    wrappedRules[ruleName] = wrapRule(rule);
  }

  return {
    ...plugin,
    rules: wrappedRules,
  };
}

function wrapRule(rule: Rule.RuleModule): Rule.RuleModule {
  return {
    ...rule,
    create(context) {
      return rule.create(createLegacyContextProxy(context));
    },
  };
}

function createLegacyContextProxy(context: Rule.RuleContext): Rule.RuleContext {
  return new Proxy(context, {
    get(target, property, receiver) {
      switch (property) {
        case "getCwd":
          return () => target.cwd;
        case "getFilename":
          return () => target.filename;
        case "getPhysicalFilename":
          return () => target.physicalFilename;
        case "getSourceCode":
          return () => target.sourceCode;
        case "parserOptions":
          return target.languageOptions.parserOptions;
        default: {
          const value: unknown = Reflect.get(target, property, receiver);
          return value;
        }
      }
    },
  });
}
