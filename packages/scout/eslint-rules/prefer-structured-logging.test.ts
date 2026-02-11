import { RuleTester } from "@typescript-eslint/rule-tester";
import { preferStructuredLogging } from "./prefer-structured-logging";
import { describe, it, afterAll } from "bun:test";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester();

ruleTester.run("prefer-structured-logging", preferStructuredLogging, {
  valid: [
    // Using logger is allowed
    {
      code: 'logger.info("Hello");',
    },
    {
      code: 'logger.error("Error occurred");',
    },
    {
      code: 'logger.debug("Debug info");',
    },
    // Console methods not in our list are allowed (for now)
    {
      code: "console.table(data);",
    },
    {
      code: "console.time('perf');",
    },
    {
      code: "console.dir(obj);",
    },
  ],
  invalid: [
    {
      code: 'console.log("Hello");',
      errors: [{ messageId: "preferLogger" }],
    },
    {
      code: 'console.error("Error occurred");',
      errors: [{ messageId: "preferLogger" }],
    },
    {
      code: 'console.warn("Warning");',
      errors: [{ messageId: "preferLogger" }],
    },
    {
      code: 'console.info("Info");',
      errors: [{ messageId: "preferLogger" }],
    },
    {
      code: 'console.debug("Debug");',
      errors: [{ messageId: "preferLogger" }],
    },
    {
      code: 'console.trace("Trace");',
      errors: [{ messageId: "preferLogger" }],
    },
    // Multiple console calls
    {
      code: `
        console.log("First");
        console.error("Second");
      `,
      errors: [{ messageId: "preferLogger" }, { messageId: "preferLogger" }],
    },
  ],
});
