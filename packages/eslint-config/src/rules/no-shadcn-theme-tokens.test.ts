import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "bun:test";
import { noShadcnThemeTokens } from "./no-shadcn-theme-tokens";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaFeatures: { jsx: true },
      projectService: false,
    },
  },
});

ruleTester.run("no-shadcn-theme-tokens", noShadcnThemeTokens, {
  valid: [
    { code: 'const x = <div className="text-gray-900 dark:text-white" />;' },
    { code: 'const x = <div className="bg-indigo-600 text-white" />;' },
    { code: 'const x = <div className="border-gray-200 dark:border-gray-700" />;' },
    { code: 'const x = <div className="text-gray-600 dark:text-gray-300" />;' },
    { code: 'const x = <div className="bg-white dark:bg-gray-900" />;' },
    { code: 'const x = cn("text-gray-900", "dark:text-white");' },
    { code: 'const x = clsx("bg-indigo-600", "text-white");' },
    { code: 'const x = twMerge("border-gray-200", "dark:border-gray-700");' },
    { code: 'const x = <div className="flex items-center gap-4" />;' },
    { code: 'const x = <div className="w-full h-screen" />;' },
    { code: 'const x = <div className="rounded-lg shadow-md" />;' },
    { code: 'const x = <div className={`text-gray-900 ${condition ? "font-bold" : ""}`} />;' },
    { code: 'const classes = ["text-gray-900", "bg-white"];' },
    { code: 'const x = <div data-theme="foreground" />;' },
    { code: 'const x = <div title="text-foreground is a token" />;' },
    { code: 'const x = <div className="custom-foreground-style" />;' },
    { code: 'const x = <div className="" />;' },
  ],
  invalid: [
    { code: 'const x = <div className="text-foreground" />;', errors: [{ messageId: "noShadcnToken", data: { token: "text-foreground" } }] },
    { code: 'const x = <div className="text-muted-foreground" />;', errors: [{ messageId: "noShadcnToken", data: { token: "text-muted-foreground" } }] },
    { code: 'const x = <div className="bg-background" />;', errors: [{ messageId: "noShadcnToken", data: { token: "bg-background" } }] },
    { code: 'const x = <div className="bg-primary" />;', errors: [{ messageId: "noShadcnToken", data: { token: "bg-primary" } }] },
    { code: 'const x = <div className="bg-card" />;', errors: [{ messageId: "noShadcnToken", data: { token: "bg-card" } }] },
    { code: 'const x = <div className="bg-muted" />;', errors: [{ messageId: "noShadcnToken", data: { token: "bg-muted" } }] },
    { code: 'const x = <div className="border-border" />;', errors: [{ messageId: "noShadcnToken", data: { token: "border-border" } }] },
    { code: 'const x = <div className="border-input" />;', errors: [{ messageId: "noShadcnToken", data: { token: "border-input" } }] },
    {
      code: 'const x = <div className="text-foreground bg-background border-border" />;',
      errors: [
        { messageId: "noShadcnToken", data: { token: "text-foreground" } },
        { messageId: "noShadcnToken", data: { token: "bg-background" } },
        { messageId: "noShadcnToken", data: { token: "border-border" } },
      ],
    },
    { code: 'const x = <div className="flex text-foreground items-center" />;', errors: [{ messageId: "noShadcnToken", data: { token: "text-foreground" } }] },
    { code: 'const x = cn("text-foreground", className);', errors: [{ messageId: "noShadcnToken", data: { token: "text-foreground" } }] },
    {
      code: 'const x = clsx("bg-primary", "text-primary-foreground");',
      errors: [
        { messageId: "noShadcnToken", data: { token: "bg-primary" } },
        { messageId: "noShadcnToken", data: { token: "text-primary-foreground" } },
      ],
    },
    { code: "const x = <div className={`text-foreground ${extra}`} />;", errors: [{ messageId: "noShadcnToken", data: { token: "text-foreground" } }] },
    { code: 'const x = <div className={"text-muted-foreground"} />;', errors: [{ messageId: "noShadcnToken", data: { token: "text-muted-foreground" } }] },
    { code: 'const classes = ["text-foreground", "font-bold"];', errors: [{ messageId: "noShadcnToken", data: { token: "text-foreground" } }] },
    { code: 'const x = <div className="ring-ring" />;', errors: [{ messageId: "noShadcnToken", data: { token: "ring-ring" } }] },
    { code: 'const x = <div className="text-primary" />;', errors: [{ messageId: "noShadcnToken", data: { token: "text-primary" } }] },
    {
      code: 'const x = <div className="bg-destructive text-destructive-foreground" />;',
      errors: [
        { messageId: "noShadcnToken", data: { token: "bg-destructive" } },
        { messageId: "noShadcnToken", data: { token: "text-destructive-foreground" } },
      ],
    },
  ],
});
