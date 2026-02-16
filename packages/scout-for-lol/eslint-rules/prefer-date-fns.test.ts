import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "bun:test";
import { preferDateFns } from "./prefer-date-fns";

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

ruleTester.run("prefer-date-fns", preferDateFns, {
  valid: [
    {
      name: "allows date-fns functions",
      code: `import { differenceInDays } from 'date-fns'; const days = differenceInDays(end, start);`,
    },
    {
      name: "allows date-fns formatting",
      code: `import { format } from 'date-fns'; const formatted = format(date, 'yyyy-MM-dd');`,
    },
    {
      name: "allows simple Date constructor",
      code: `const now = new Date();`,
    },
  ],
  invalid: [
    {
      name: "disallows getTime() arithmetic for days",
      code: `const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);`,
      errors: [
        {
          messageId: "getTimeMath",
        },
      ],
    },
    {
      name: "disallows getTime() / 1000 for Unix timestamp",
      code: `const timestamp = date.getTime() / 1000;`,
      errors: [
        {
          messageId: "getTimeMath",
        },
      ],
    },
    {
      name: "disallows setDate mutations",
      code: `date.setDate(date.getDate() + 1);`,
      errors: [
        {
          messageId: "setDateMutation",
        },
      ],
    },
    {
      name: "disallows setUTCHours mutations",
      code: `date.setUTCHours(0, 0, 0, 0);`,
      errors: [
        {
          messageId: "setDateMutation",
        },
      ],
    },
    {
      name: "disallows toLocaleString",
      code: `const formatted = date.toLocaleString();`,
      errors: [
        {
          messageId: "toLocaleStringFormatting",
        },
      ],
    },
    {
      name: "disallows toISOString().replace()",
      code: `const filename = date.toISOString().replace(/:/g, '-');`,
      errors: [
        {
          messageId: "isoStringReplace",
        },
      ],
    },
  ],
});
