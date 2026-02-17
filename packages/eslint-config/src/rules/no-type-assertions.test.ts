import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "bun:test";
import { noTypeAssertions } from "./no-type-assertions";

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

ruleTester.run("no-type-assertions", noTypeAssertions, {
  valid: [
    { code: `const x = value as unknown;` },
    { code: `const x = { key: "value" } as const;` },
    { code: `const x = <unknown>value;` },
    { code: `const colors = ["red", "blue"] as const;` },
  ],
  invalid: [
    {
      code: `const x = value as string;`,
      errors: [{ messageId: "noAsExpression" }],
    },
    {
      code: `const x = data as MyInterface;`,
      errors: [{ messageId: "noAsExpression" }],
    },
    {
      code: `const x = <string>value;`,
      errors: [{ messageId: "noTypeAssertion" }],
    },
    {
      code: `const x = value as any;`,
      errors: [{ messageId: "noAsExpression" }],
    },
    {
      code: `const x = (value as unknown) as string;`,
      errors: [{ messageId: "noAsExpression" }],
    },
  ],
});
