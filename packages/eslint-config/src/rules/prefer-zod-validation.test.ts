import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "bun:test";
import { preferZodValidation } from "./prefer-zod-validation";

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

ruleTester.run("prefer-zod-validation", preferZodValidation, {
  valid: [
    { code: `if (typeof obj.field === "string") { console.log(obj.field); }` },
    { code: `if (typeof obj.nested.value === "string") { console.log(obj.nested.value); }` },
    { code: `if (data.user.profile.settings.theme === "dark") { }` },
    { code: `if (obj.field instanceof Error) { console.log(obj.field); }` },
    { code: `if (obj.value instanceof MyClass) { console.log(obj.value); }` },
    { code: `if (typeof obj.a === "string" && typeof obj.b === "number") { }` },
    { code: `const result = schema.safeParse(data);` },
    { code: `const user = schema.parse(data); console.log(user.name.first);` },
    { code: `if (obj && typeof obj.field === "string") { }` },
    { code: `if (obj && typeof obj.field === "string") { }` },
    { code: `if (typeof obj === "object") { }` },
    { code: `if ("field" in obj) { }` },
    { code: `if (typeof obj === "object" && "field" in other) { }` },
  ],
  invalid: [
    {
      code: `if (typeof obj.field === "string") { const x = typeof obj.field === "number"; }`,
      errors: [{ messageId: "repeatedTypeChecking" }],
    },
    {
      code: `if (typeof user.profile.role === "string") { } if (typeof user.profile.role === "admin") { }`,
      errors: [{ messageId: "repeatedTypeChecking" }],
    },
    {
      code: `if (obj.error instanceof Error) { const isErr = obj.error instanceof Error; }`,
      errors: [{ messageId: "repeatedTypeChecking" }],
    },
    {
      code: `const isValid = obj && typeof obj === "object" && "field" in obj && typeof obj.field === "string";`,
      errors: [{ messageId: "objectTypeCheck" }],
    },
    {
      code: `const isAdmin = member && typeof member === "object" && "permissions" in member && member.permissions && typeof member.permissions.has === "function";`,
      errors: [{ messageId: "objectTypeCheck" }],
    },
    {
      code: `if (typeof a === "string" && typeof b === "number" && typeof c === "boolean") { }`,
      errors: [{ messageId: "complexTypeChecking" }],
    },
    {
      code: `const valid = typeof obj === "object" && "prop" in obj && obj.prop instanceof Error;`,
      errors: [{ messageId: "objectTypeCheck" }],
    },
    {
      code: `if (typeof obj === "object" && "field" in obj) { }`,
      errors: [{ messageId: "objectTypeCheck" }],
    },
    {
      code: `if (obj && typeof obj === "object" && "field" in obj) { }`,
      errors: [{ messageId: "objectTypeCheck" }],
    },
    {
      code: `if (opponent && typeof opponent === "object" && "championName" in opponent && typeof opponent.championName === "string") { }`,
      errors: [{ messageId: "objectTypeCheck" }],
    },
    {
      code: `if (typeof data === "object" && "name" in data && "age" in data) { }`,
      errors: [{ messageId: "objectTypeCheck" }],
    },
  ],
});
