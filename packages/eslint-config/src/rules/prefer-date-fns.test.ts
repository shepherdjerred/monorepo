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
      code: `import { differenceInDays } from 'date-fns'; const days = differenceInDays(end, start);`,
    },
    {
      code: `import { format } from 'date-fns'; const formatted = format(date, 'yyyy-MM-dd');`,
    },
    {
      code: `const now = new Date();`,
    },
  ],
  invalid: [
    {
      code: `const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);`,
      errors: [{ messageId: "getTimeMath" }],
    },
    {
      code: `const timestamp = date.getTime() / 1000;`,
      errors: [{ messageId: "getTimeMath" }],
    },
    {
      code: `date.setDate(date.getDate() + 1);`,
      errors: [{ messageId: "setDateMutation" }],
    },
    {
      code: `date.setUTCHours(0, 0, 0, 0);`,
      errors: [{ messageId: "setDateMutation" }],
    },
    {
      code: `const formatted = date.toLocaleString();`,
      errors: [{ messageId: "toLocaleStringFormatting" }],
    },
    {
      code: `const filename = date.toISOString().replace(/:/g, '-');`,
      errors: [{ messageId: "isoStringReplace" }],
    },
  ],
});
