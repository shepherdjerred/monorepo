import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "bun:test";
import { noTypeGuards } from "./no-type-guards";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      projectService: false,
    },
  },
});

ruleTester.run("no-type-guards", noTypeGuards, {
  valid: [
    { code: `function isString(value: unknown): boolean { return typeof value === "string"; }` },
    { code: `const isString = (value: unknown): boolean => typeof value === "string";` },
    { code: `const isString = function(value: unknown): boolean { return typeof value === "string"; };` },
    {
      code: `class Validator { isValid(value: unknown): boolean { return true; } }`,
    },
    { code: `function isString(value: unknown) { return typeof value === "string"; }` },
    { code: `const isString = (value: unknown) => typeof value === "string";` },
  ],
  invalid: [
    {
      code: `function isString(value: unknown): value is string { return typeof value === "string"; }`,
      errors: [{ messageId: "noTypeGuard" }],
    },
    {
      code: `const isString = (value: unknown): value is string => typeof value === "string";`,
      errors: [{ messageId: "noTypeGuard" }],
    },
    {
      code: `const isString = function(value: unknown): value is string { return typeof value === "string"; };`,
      errors: [{ messageId: "noTypeGuard" }],
    },
    {
      code: `class Validator { isString(value: unknown): value is string { return typeof value === "string"; } }`,
      errors: [{ messageId: "noTypeGuard" }],
    },
    {
      code: `function isUser(value: unknown): value is { id: string; name: string } { return typeof value === "object" && value !== null; }`,
      errors: [{ messageId: "noTypeGuard" }],
    },
    {
      code: `interface User { id: string; } function isUser(value: unknown): value is User { return typeof value === "object"; }`,
      errors: [{ messageId: "noTypeGuard" }],
    },
    {
      code: `function isPackageName(value: string): value is "backend" | "frontend" { return value === "backend" || value === "frontend"; }`,
      errors: [{ messageId: "noTypeGuard" }],
    },
  ],
});
