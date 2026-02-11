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
    {
      name: "allows 'as unknown' type assertion",
      code: `const x = value as unknown;`,
    },
    {
      name: "allows 'as const' type assertion",
      code: `const x = { key: "value" } as const;`,
    },
    {
      name: "allows '<unknown>' type assertion",
      code: `const x = <unknown>value;`,
    },
    {
      name: "allows array as const",
      code: `const colors = ["red", "blue"] as const;`,
    },
  ],
  invalid: [
    {
      name: "disallows 'as' type assertion to specific type",
      code: `const x = value as string;`,
      errors: [
        {
          messageId: "noAsExpression",
        },
      ],
    },
    {
      name: "disallows 'as' assertion to interface",
      code: `const x = data as MyInterface;`,
      errors: [
        {
          messageId: "noAsExpression",
        },
      ],
    },
    {
      name: "disallows angle bracket assertion to specific type",
      code: `const x = <string>value;`,
      errors: [
        {
          messageId: "noTypeAssertion",
        },
      ],
    },
    {
      name: "disallows 'as any'",
      code: `const x = value as any;`,
      errors: [
        {
          messageId: "noAsExpression",
        },
      ],
    },
    {
      name: "disallows chained assertion (not to unknown)",
      code: `const x = (value as unknown) as string;`,
      errors: [
        {
          messageId: "noAsExpression",
        },
      ],
    },
  ],
});
