import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "bun:test";
import { noFunctionOverloads } from "./no-function-overloads";

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

ruleTester.run("no-function-overloads", noFunctionOverloads, {
  valid: [
    { code: `function myFunction(x: string | number): void { console.log(x); }` },
    { code: `function process(input: string | number): string { return String(input); }` },
    { code: `function greet(name: string, title?: string): string { return title ? \`\${title} \${name}\` : name; }` },
  ],
  invalid: [
    {
      code: `
        function myFunction(x: string): void;
        function myFunction(x: number): void;
        function myFunction(x: string | number): void { console.log(x); }
      `,
      errors: [{ messageId: "functionOverload" }, { messageId: "functionOverload" }, { messageId: "functionOverload" }],
    },
    {
      code: `
        export function process(x: string): string;
        export function process(x: number): string;
        export function process(x: string | number): string { return String(x); }
      `,
      errors: [{ messageId: "functionOverload" }, { messageId: "functionOverload" }, { messageId: "functionOverload" }],
    },
  ],
});
