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
    {
      name: "allows regular function without type predicate",
      code: `function isString(value: unknown): boolean {
        return typeof value === "string";
      }`,
    },
    {
      name: "allows arrow function without type predicate",
      code: `const isString = (value: unknown): boolean => typeof value === "string";`,
    },
    {
      name: "allows function expression without type predicate",
      code: `const isString = function(value: unknown): boolean {
        return typeof value === "string";
      };`,
    },
    {
      name: "allows method without type predicate",
      code: `class Validator {
        isValid(value: unknown): boolean {
          return true;
        }
      }`,
    },
    {
      name: "allows function without return type annotation",
      code: `function isString(value: unknown) {
        return typeof value === "string";
      }`,
    },
    {
      name: "allows arrow function without return type annotation",
      code: `const isString = (value: unknown) => typeof value === "string";`,
    },
  ],
  invalid: [
    {
      name: "disallows function declaration with type predicate",
      code: `function isString(value: unknown): value is string {
        return typeof value === "string";
      }`,
      errors: [
        {
          messageId: "noTypeGuard",
        },
      ],
    },
    {
      name: "disallows arrow function with type predicate",
      code: `const isString = (value: unknown): value is string => typeof value === "string";`,
      errors: [
        {
          messageId: "noTypeGuard",
        },
      ],
    },
    {
      name: "disallows function expression with type predicate",
      code: `const isString = function(value: unknown): value is string {
        return typeof value === "string";
      };`,
      errors: [
        {
          messageId: "noTypeGuard",
        },
      ],
    },
    {
      name: "disallows method with type predicate",
      code: `class Validator {
        isString(value: unknown): value is string {
          return typeof value === "string";
        }
      }`,
      errors: [
        {
          messageId: "noTypeGuard",
        },
      ],
    },
    {
      name: "disallows type predicate with complex type",
      code: `function isUser(value: unknown): value is { id: string; name: string } {
        return typeof value === "object" && value !== null;
      }`,
      errors: [
        {
          messageId: "noTypeGuard",
        },
      ],
    },
    {
      name: "disallows type predicate with interface type",
      code: `interface User {
        id: string;
      }
      function isUser(value: unknown): value is User {
        return typeof value === "object";
      }`,
      errors: [
        {
          messageId: "noTypeGuard",
        },
      ],
    },
    {
      name: "disallows type predicate with union type",
      code: `function isPackageName(value: string): value is "backend" | "frontend" {
        return value === "backend" || value === "frontend";
      }`,
      errors: [
        {
          messageId: "noTypeGuard",
        },
      ],
    },
  ],
});
