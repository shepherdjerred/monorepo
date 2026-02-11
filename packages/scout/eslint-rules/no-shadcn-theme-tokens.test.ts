import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "bun:test";
import { noShadcnThemeTokens } from "./no-shadcn-theme-tokens";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaFeatures: {
        jsx: true,
      },
      projectService: false,
    },
  },
});

ruleTester.run("no-shadcn-theme-tokens", noShadcnThemeTokens, {
  valid: [
    // Explicit Tailwind colors are allowed
    {
      name: "allows explicit Tailwind text colors",
      code: 'const x = <div className="text-gray-900 dark:text-white" />;',
    },
    {
      name: "allows explicit Tailwind background colors",
      code: 'const x = <div className="bg-indigo-600 text-white" />;',
    },
    {
      name: "allows explicit Tailwind border colors",
      code: 'const x = <div className="border-gray-200 dark:border-gray-700" />;',
    },
    {
      name: "allows explicit muted text colors",
      code: 'const x = <div className="text-gray-600 dark:text-gray-300" />;',
    },
    {
      name: "allows explicit dark mode backgrounds",
      code: 'const x = <div className="bg-white dark:bg-gray-900" />;',
    },

    // Class utilities with explicit colors
    {
      name: "allows cn() with explicit colors",
      code: 'const x = cn("text-gray-900", "dark:text-white");',
    },
    {
      name: "allows clsx() with explicit colors",
      code: 'const x = clsx("bg-indigo-600", "text-white");',
    },
    {
      name: "allows twMerge() with explicit colors",
      code: 'const x = twMerge("border-gray-200", "dark:border-gray-700");',
    },

    // Regular classes without theme tokens
    {
      name: "allows layout classes",
      code: 'const x = <div className="flex items-center gap-4" />;',
    },
    {
      name: "allows sizing classes",
      code: 'const x = <div className="w-full h-screen" />;',
    },
    {
      name: "allows utility classes",
      code: 'const x = <div className="rounded-lg shadow-md" />;',
    },

    // Template literals with explicit colors
    {
      name: "allows template literals with explicit colors",
      code: 'const x = <div className={`text-gray-900 ${condition ? "font-bold" : ""}`} />;',
    },

    // Array syntax with explicit colors
    {
      name: "allows arrays with explicit colors",
      code: 'const classes = ["text-gray-900", "bg-white"];',
    },

    // Non-class attributes can have any value
    {
      name: "ignores non-class data attributes",
      code: 'const x = <div data-theme="foreground" />;',
    },
    {
      name: "ignores title attributes",
      code: 'const x = <div title="text-foreground is a token" />;',
    },

    // Partial matches should not trigger
    {
      name: "ignores partial matches in custom class names",
      code: 'const x = <div className="custom-foreground-style" />;',
    },

    // Empty strings
    {
      name: "allows empty className",
      code: 'const x = <div className="" />;',
    },
  ],
  invalid: [
    // Direct className with text-foreground
    {
      name: "disallows text-foreground",
      code: 'const x = <div className="text-foreground" />;',
      errors: [{ messageId: "noShadcnToken", data: { token: "text-foreground" } }],
    },
    // Direct className with text-muted-foreground
    {
      name: "disallows text-muted-foreground",
      code: 'const x = <div className="text-muted-foreground" />;',
      errors: [{ messageId: "noShadcnToken", data: { token: "text-muted-foreground" } }],
    },
    // Background tokens
    {
      name: "disallows bg-background",
      code: 'const x = <div className="bg-background" />;',
      errors: [{ messageId: "noShadcnToken", data: { token: "bg-background" } }],
    },
    {
      name: "disallows bg-primary",
      code: 'const x = <div className="bg-primary" />;',
      errors: [{ messageId: "noShadcnToken", data: { token: "bg-primary" } }],
    },
    {
      name: "disallows bg-card",
      code: 'const x = <div className="bg-card" />;',
      errors: [{ messageId: "noShadcnToken", data: { token: "bg-card" } }],
    },
    {
      name: "disallows bg-muted",
      code: 'const x = <div className="bg-muted" />;',
      errors: [{ messageId: "noShadcnToken", data: { token: "bg-muted" } }],
    },
    // Border tokens
    {
      name: "disallows border-border",
      code: 'const x = <div className="border-border" />;',
      errors: [{ messageId: "noShadcnToken", data: { token: "border-border" } }],
    },
    {
      name: "disallows border-input",
      code: 'const x = <div className="border-input" />;',
      errors: [{ messageId: "noShadcnToken", data: { token: "border-input" } }],
    },
    // Multiple tokens in one string
    {
      name: "reports multiple tokens in one className",
      code: 'const x = <div className="text-foreground bg-background border-border" />;',
      errors: [
        { messageId: "noShadcnToken", data: { token: "text-foreground" } },
        { messageId: "noShadcnToken", data: { token: "bg-background" } },
        { messageId: "noShadcnToken", data: { token: "border-border" } },
      ],
    },
    // Mixed with valid classes
    {
      name: "reports token mixed with valid classes",
      code: 'const x = <div className="flex text-foreground items-center" />;',
      errors: [{ messageId: "noShadcnToken", data: { token: "text-foreground" } }],
    },
    // In cn() utility
    {
      name: "reports token in cn() utility",
      code: 'const x = cn("text-foreground", className);',
      errors: [{ messageId: "noShadcnToken", data: { token: "text-foreground" } }],
    },
    // In clsx() utility
    {
      name: "reports tokens in clsx() utility",
      code: 'const x = clsx("bg-primary", "text-primary-foreground");',
      errors: [
        { messageId: "noShadcnToken", data: { token: "bg-primary" } },
        { messageId: "noShadcnToken", data: { token: "text-primary-foreground" } },
      ],
    },
    // Template literal
    {
      name: "reports token in template literal",
      code: "const x = <div className={`text-foreground ${extra}`} />;",
      errors: [{ messageId: "noShadcnToken", data: { token: "text-foreground" } }],
    },
    // Expression with string literal
    {
      name: "reports token in expression string literal",
      code: 'const x = <div className={"text-muted-foreground"} />;',
      errors: [{ messageId: "noShadcnToken", data: { token: "text-muted-foreground" } }],
    },
    // Array with token
    {
      name: "reports token in array",
      code: 'const classes = ["text-foreground", "font-bold"];',
      errors: [{ messageId: "noShadcnToken", data: { token: "text-foreground" } }],
    },
    // Ring colors
    {
      name: "disallows ring-ring",
      code: 'const x = <div className="ring-ring" />;',
      errors: [{ messageId: "noShadcnToken", data: { token: "ring-ring" } }],
    },
    // text-primary (semantic color token)
    {
      name: "disallows text-primary",
      code: 'const x = <div className="text-primary" />;',
      errors: [{ messageId: "noShadcnToken", data: { token: "text-primary" } }],
    },
    // Destructive variants
    {
      name: "reports destructive tokens",
      code: 'const x = <div className="bg-destructive text-destructive-foreground" />;',
      errors: [
        { messageId: "noShadcnToken", data: { token: "bg-destructive" } },
        { messageId: "noShadcnToken", data: { token: "text-destructive-foreground" } },
      ],
    },
  ],
});
