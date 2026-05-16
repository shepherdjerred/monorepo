---
name: eslint-rule-dev
description: |
  ESLint custom rule development - AST traversal, rule testing, plugins, and flat config
  When user creates ESLint rules, develops ESLint plugins, works with AST, or mentions RuleTester
---

# ESLint Rule Development Agent

## What's New in ESLint 9+ (2024-2025)

- **Flat config**: `eslint.config.js` replaces `.eslintrc.*`
- **ESM support**: Native ES modules in configs and rules
- **`defineConfig()` helper**: Type-safe configuration with autocomplete
- **Stricter plugin format**: Plugins must use new object structure
- **Removed formatters**: Many built-in formatters moved to packages

## Rule Structure

Every ESLint rule exports an object with `meta` and `create`:

```javascript
export default {
  meta: {
    type: "problem", // "problem" | "suggestion" | "layout"
    docs: {
      description: "Disallow foo assigned to anything other than bar",
      recommended: true,
      url: "https://example.com/rules/no-foo",
    },
    fixable: "code", // "code" | "whitespace" | null
    hasSuggestions: true,
    schema: [], // JSON Schema for rule options
    messages: {
      avoidFoo: "Avoid using 'foo' - use 'bar' instead.",
      suggestBar: "Replace with 'bar'.",
    },
  },

  create(context) {
    return {
      // Visitor methods for AST nodes
      Identifier(node) {
        if (node.name === "foo") {
          context.report({
            node,
            messageId: "avoidFoo",
          });
        }
      },
    };
  },
};
```

## Meta Properties

| Property           | Purpose                                          |
| ------------------ | ------------------------------------------------ |
| `type`             | Rule category: "problem", "suggestion", "layout" |
| `docs.description` | Short description for documentation              |
| `docs.recommended` | Include in recommended config                    |
| `docs.url`         | Link to full documentation                       |
| `fixable`          | Enable auto-fix ("code" or "whitespace")         |
| `hasSuggestions`   | Rule provides suggestions                        |
| `schema`           | JSON Schema for options validation               |
| `messages`         | Message templates with IDs                       |
| `defaultOptions`   | Default values for options                       |
| `deprecated`       | Mark rule as deprecated                          |

## The Context Object

The `context` object passed to `create()` provides:

### Properties

```javascript
create(context) {
  // Rule configuration
  context.id              // Rule ID (e.g., "no-console")
  context.options         // Array of configured options
  context.settings        // Shared settings from config

  // File information
  context.filename        // Current file path
  context.cwd             // Current working directory

  // Source code access
  context.sourceCode      // SourceCode object for analysis

  // Language configuration
  context.languageOptions // Parser options, globals, etc.
}
```

### Methods

```javascript
// Report a problem
context.report({
  node,
  messageId: "myMessage",
  data: { name: "foo" },
  fix: (fixer) => fixer.replaceText(node, "bar"),
});
```

## AST Node Visitors

Rules work by defining visitor functions for AST node types:

```javascript
create(context) {
  return {
    // Called when entering a node
    CallExpression(node) {
      // Analyze call expressions
    },

    // Called when exiting a node (use ":exit" suffix)
    "FunctionDeclaration:exit"(node) {
      // Run after all children processed
    },

    // Selector syntax for complex matching
    "CallExpression[callee.name='require']"(node) {
      // Only matches require() calls
    },
  };
}
```

### Common Node Types

| Node Type                  | Matches                        |
| -------------------------- | ------------------------------ |
| `Identifier`               | Variable names, function names |
| `Literal`                  | Strings, numbers, booleans     |
| `CallExpression`           | Function calls                 |
| `MemberExpression`         | Property access (a.b, a['b'])  |
| `FunctionDeclaration`      | Named function declarations    |
| `ArrowFunctionExpression`  | Arrow functions                |
| `VariableDeclaration`      | let, const, var declarations   |
| `ImportDeclaration`        | import statements              |
| `ExportDefaultDeclaration` | export default                 |

## AST Selectors

ESLint supports CSS-like selectors for targeting nodes:

```javascript
// Basic selectors
"Identifier"; // Any identifier
"CallExpression"; // Any function call

// Attribute selectors
"Identifier[name='foo']"; // Identifier named "foo"
"Literal[value=123]"; // Literal with value 123
"CallExpression[callee.name='require']"; // require() calls

// Descendant selectors
"FunctionDeclaration Identifier"; // Identifiers inside functions

// Child selectors
"CallExpression > MemberExpression"; // Direct child

// Sibling selectors
"VariableDeclaration ~ VariableDeclaration"; // Following sibling

// Pseudo-classes
":first-child"; // First child node
":last-child"; // Last child node
":nth-child(2)"; // Second child
":not(Literal)"; // Not a Literal

// Combinations
"CallExpression[callee.object.name='console'][callee.property.name='log']";
```

## Reporting Problems

### Basic Report

```javascript
context.report({
  node: node,
  messageId: "unexpectedFoo",
  data: { name: node.name },
});
```

### Report with Location

```javascript
context.report({
  loc: {
    start: { line: 1, column: 0 },
    end: { line: 1, column: 5 },
  },
  messageId: "unexpectedFoo",
});
```

### Report with Fix

```javascript
context.report({
  node,
  messageId: "useBar",
  fix(fixer) {
    return fixer.replaceText(node, "bar");
  },
});
```

### Report with Suggestions

```javascript
context.report({
  node,
  messageId: "useBetterName",
  suggest: [
    {
      messageId: "renameToBar",
      fix(fixer) {
        return fixer.replaceText(node, "bar");
      },
    },
    {
      messageId: "renameToQux",
      fix(fixer) {
        return fixer.replaceText(node, "qux");
      },
    },
  ],
});
```

## Fixer Methods

The `fixer` object provides these methods:

```javascript
// Insert text
fixer.insertTextBefore(node, "text");
fixer.insertTextAfter(node, "text");
fixer.insertTextBeforeRange([start, end], "text");
fixer.insertTextAfterRange([start, end], "text");

// Remove
fixer.remove(node);
fixer.removeRange([start, end]);

// Replace
fixer.replaceText(node, "newText");
fixer.replaceTextRange([start, end], "newText");
```

### Multiple Fixes

Return an array or iterable for multiple fixes:

```javascript
fix(fixer) {
  return [
    fixer.insertTextBefore(node, "/* comment */ "),
    fixer.replaceText(node.property, "info"),
  ];
}
```

## Accessing Source Code

```javascript
create(context) {
  const sourceCode = context.sourceCode;

  return {
    CallExpression(node) {
      // Get source text
      const text = sourceCode.getText(node);

      // Get tokens
      const tokens = sourceCode.getTokens(node);
      const firstToken = sourceCode.getFirstToken(node);
      const lastToken = sourceCode.getLastToken(node);

      // Get comments
      const commentsBefore = sourceCode.getCommentsBefore(node);
      const commentsAfter = sourceCode.getCommentsAfter(node);
      const commentsInside = sourceCode.getCommentsInside(node);

      // Get scope information
      const scope = sourceCode.getScope(node);
      const variables = sourceCode.getDeclaredVariables(node);
    }
  };
}
```

## Scope Analysis

Access variable scopes for advanced analysis:

```javascript
create(context) {
  return {
    "Program:exit"(node) {
      const scope = context.sourceCode.getScope(node);

      // All variables in scope
      scope.variables.forEach(variable => {
        console.log(variable.name);
        console.log(variable.references);  // Where it's used
        console.log(variable.defs);        // Where it's defined
      });

      // Unresolved references (global access)
      scope.through.forEach(reference => {
        console.log(reference.identifier.name);
      });

      // Child scopes
      scope.childScopes.forEach(childScope => {
        console.log(childScope.type);  // "function", "block", etc.
      });
    }
  };
}
```

## Rule Options

Define options using JSON Schema:

```javascript
export default {
  meta: {
    schema: [
      {
        type: "object",
        properties: {
          allowFoo: { type: "boolean", default: false },
          maxLength: { type: "integer", minimum: 1 },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ allowFoo: false, maxLength: 10 }],
  },

  create(context) {
    const options = context.options[0] || {};
    const allowFoo = options.allowFoo ?? false;
    const maxLength = options.maxLength ?? 10;

    return {
      /* visitors */
    };
  },
};
```

## Testing with RuleTester

### Basic Test Setup

```javascript
import { RuleTester } from "eslint";
import rule from "./my-rule.js";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
});

ruleTester.run("my-rule", rule, {
  valid: [
    // Code that should pass
    "const bar = 'hello';",
    { code: "const foo = 'bar';", options: [{ allowFoo: true }] },
  ],

  invalid: [
    {
      code: "const foo = 'hello';",
      errors: [{ messageId: "unexpectedFoo" }],
    },
    {
      code: "const foo = 'hello';",
      output: "const foo = 'bar';", // Expected after fix
      errors: [{ messageId: "unexpectedFoo" }],
    },
  ],
});
```

### Test Case Properties

```javascript
{
  code: "const foo = 123;",           // Code to lint
  output: "const foo = 'bar';",       // Expected output after fix
  options: [{ allowFoo: false }],     // Rule options
  errors: [
    {
      messageId: "unexpectedFoo",
      data: { name: "foo" },
      type: "VariableDeclarator",
      line: 1,
      column: 7,
      endLine: 1,
      endColumn: 10,
      suggestions: [
        {
          messageId: "renameToBar",
          output: "const bar = 123;",
        }
      ]
    }
  ],
  filename: "test.js",                // Virtual filename
  only: true,                         // Run only this test
}
```

### TypeScript-ESLint Testing

```javascript
import { RuleTester } from "@typescript-eslint/rule-tester";
import rule from "./my-ts-rule";

const ruleTester = new RuleTester({
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: "./tsconfig.json",
  },
});
```

## Creating a Plugin

### Plugin Structure

```javascript
// eslint-plugin-myplugin/index.js
import noFoo from "./rules/no-foo.js";
import preferBar from "./rules/prefer-bar.js";

export default {
  meta: {
    name: "eslint-plugin-myplugin",
    version: "1.0.0",
  },

  rules: {
    "no-foo": noFoo,
    "prefer-bar": preferBar,
  },

  configs: {
    recommended: {
      plugins: {
        myplugin: plugin,
      },
      rules: {
        "myplugin/no-foo": "error",
        "myplugin/prefer-bar": "warn",
      },
    },
  },
};

const plugin = { meta, rules, configs };
```

### Using the Plugin

```javascript
// eslint.config.js
import myplugin from "eslint-plugin-myplugin";

export default [
  {
    plugins: { myplugin },
    rules: {
      "myplugin/no-foo": "error",
    },
  },

  // Or use the recommended config
  myplugin.configs.recommended,
];
```

## Local Rules (Without Publishing)

### Using eslint-plugin-local-rules

```javascript
// eslint-local-rules/no-foo.js
export default {
  meta: { /* ... */ },
  create(context) { /* ... */ }
};

// eslint-local-rules/index.js
import noFoo from "./no-foo.js";

export default {
  rules: { "no-foo": noFoo }
};
```

```javascript
// eslint.config.js
import localRules from "./eslint-local-rules/index.js";

export default [
  {
    plugins: { local: localRules },
    rules: {
      "local/no-foo": "error",
    },
  },
];
```

## TypeScript Rules

### Using @typescript-eslint/utils

```typescript
import { ESLintUtils } from "@typescript-eslint/utils";

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://example.com/rules/${name}`,
);

export default createRule({
  name: "no-unsafe-any",
  meta: {
    type: "problem",
    docs: { description: "Disallow unsafe any usage" },
    messages: { unsafeAny: "Avoid using 'any' type" },
    schema: [],
  },

  defaultOptions: [],

  create(context) {
    return {
      TSAnyKeyword(node) {
        context.report({ node, messageId: "unsafeAny" });
      },
    };
  },
});
```

### Accessing Type Information

```typescript
import { ESLintUtils } from "@typescript-eslint/utils";

create(context) {
  const services = ESLintUtils.getParserServices(context);
  const checker = services.program.getTypeChecker();

  return {
    Identifier(node) {
      const tsNode = services.esTreeNodeToTSNodeMap.get(node);
      const type = checker.getTypeAtLocation(tsNode);
      const typeString = checker.typeToString(type);

      if (typeString === "any") {
        context.report({ node, messageId: "foundAny" });
      }
    },
  };
}
```

## Best Practices Summary

1. **Use `messageId`** instead of inline strings for messages
2. **Define `schema`** for any rule options
3. **Set `meta.fixable`** if providing auto-fixes
4. **Make fixes minimal** - only change what's necessary
5. **Test both valid and invalid cases** with RuleTester
6. **Use AST Explorer** (astexplorer.net) to understand node structure
7. **Handle edge cases** - optional chaining, spread operators, etc.
8. **Provide suggestions** when multiple valid fixes exist
9. **Check for comments** before removing/replacing code
10. **Document thoroughly** with examples and rationale

## When to Ask for Help

- Complex scope analysis across multiple files
- Type-aware rules needing TypeScript integration
- Performance optimization for large codebases
- Migration from eslintrc to flat config
- Custom parsers for non-standard syntax
- Rule conflicts and fix ordering issues
