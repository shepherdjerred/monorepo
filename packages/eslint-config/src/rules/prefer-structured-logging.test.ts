import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "bun:test";
import { preferStructuredLogging } from "./prefer-structured-logging";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester();

ruleTester.run("prefer-structured-logging", preferStructuredLogging, {
  valid: [
    { code: 'logger.info("Hello");' },
    { code: 'logger.error("Error occurred");' },
    { code: 'logger.debug("Debug info");' },
    { code: "console.table(data);" },
    { code: "console.time('perf');" },
    { code: "console.dir(obj);" },
  ],
  invalid: [
    { code: 'console.log("Hello");', errors: [{ messageId: "preferLogger" }] },
    {
      code: 'console.error("Error occurred");',
      errors: [{ messageId: "preferLogger" }],
    },
    {
      code: 'console.warn("Warning");',
      errors: [{ messageId: "preferLogger" }],
    },
    { code: 'console.info("Info");', errors: [{ messageId: "preferLogger" }] },
    {
      code: 'console.debug("Debug");',
      errors: [{ messageId: "preferLogger" }],
    },
    {
      code: 'console.trace("Trace");',
      errors: [{ messageId: "preferLogger" }],
    },
    {
      code: `
        console.log("First");
        console.error("Second");
      `,
      errors: [{ messageId: "preferLogger" }, { messageId: "preferLogger" }],
    },
  ],
});
