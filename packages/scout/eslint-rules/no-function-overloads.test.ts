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
    {
      name: "allows single function declaration",
      code: `function myFunction(x: string | number): void { console.log(x); }`,
    },
    {
      name: "allows function with union types",
      code: `function process(input: string | number): string { return String(input); }`,
    },
    {
      name: "allows function with optional parameters",
      code: `function greet(name: string, title?: string): string { return title ? \`\${title} \${name}\` : name; }`,
    },
    {
      name: "allows nested functions with same name in different scopes",
      code: `
        function hasDateMutationInBody(body: unknown): boolean {
          const visitor = { found: false };
          const visited = new WeakSet<object>();

          function traverse(node: unknown) {
            if (!node || visited.has(node as object)) return;
            visited.add(node as object);
            // ... logic
          }

          traverse(body);
          return visitor.found;
        }

        function containsManualDateMath(body: unknown): boolean {
          let found = false;
          const visited = new WeakSet<object>();

          function traverse(node: unknown) {
            if (!node || found || visited.has(node as object)) return;
            visited.add(node as object);
            // ... different logic
          }

          traverse(body);
          return found;
        }
      `,
    },
    {
      name: "allows same function name in nested arrow functions",
      code: `
        const outer = () => {
          const helper = (x: number) => x * 2;
          return helper(5);
        };

        const another = () => {
          const helper = (x: string) => x.toUpperCase();
          return helper("test");
        };
      `,
    },
    {
      name: "allows same function name in different function expressions",
      code: `
        const first = function() {
          function process(x: number) {
            return x * 2;
          }
          return process(5);
        };

        const second = function() {
          function process(x: string) {
            return x.toUpperCase();
          }
          return process("test");
        };
      `,
    },
    {
      name: "allows deeply nested functions with same names",
      code: `
        function outer() {
          function middle() {
            function inner() {
              return 1;
            }
            return inner();
          }
          return middle();
        }

        function other() {
          function middle() {
            function inner() {
              return 2;
            }
            return inner();
          }
          return middle();
        }
      `,
    },
    {
      name: "allows traverse pattern from ESLint rules (original bug scenario)",
      code: `
        function hasDateMutationInBody(body: unknown): boolean {
          const visitor = { found: false };
          const visited = new WeakSet<object>();

          function traverse(node: unknown) {
            if (!node || visited.has(node as object)) return;
            visited.add(node as object);

            if ((node as any).type === "CallExpression") {
              visitor.found = true;
            }

            for (const key in node as any) {
              const value = (node as any)[key];
              if (value && typeof value === "object") {
                traverse(value);
              }
            }
          }

          traverse(body);
          return visitor.found;
        }

        function containsManualDateMath(body: unknown): boolean {
          let found = false;
          const visited = new WeakSet<object>();

          function traverse(node: unknown) {
            if (!node || found || visited.has(node as object)) return;
            visited.add(node as object);

            if ((node as any).type === "BinaryExpression") {
              found = true;
              return;
            }

            for (const key in node as any) {
              const value = (node as any)[key];
              if (value && typeof value === "object") {
                traverse(value);
              }
            }
          }

          traverse(body);
          return found;
        }
      `,
    },
  ],
  invalid: [
    {
      name: "disallows function overloads",
      code: `
        function myFunction(x: string): void;
        function myFunction(x: number): void;
        function myFunction(x: string | number): void { console.log(x); }
      `,
      errors: [
        {
          messageId: "functionOverload",
        },
        {
          messageId: "functionOverload",
        },
        {
          messageId: "functionOverload",
        },
      ],
    },
    {
      name: "disallows exported function overloads",
      code: `
        export function process(x: string): string;
        export function process(x: number): string;
        export function process(x: string | number): string { return String(x); }
      `,
      errors: [
        {
          messageId: "functionOverload",
        },
        {
          messageId: "functionOverload",
        },
        {
          messageId: "functionOverload",
        },
      ],
    },
    {
      name: "disallows multiple function overloads at module level",
      code: `
        function calculate(x: string): number;
        function calculate(x: number): number;
        function calculate(x: boolean): number;
        function calculate(x: string | number | boolean): number {
          return typeof x === 'string' ? parseInt(x) : typeof x === 'boolean' ? (x ? 1 : 0) : x;
        }
      `,
      errors: [
        {
          messageId: "functionOverload",
        },
        {
          messageId: "functionOverload",
        },
        {
          messageId: "functionOverload",
        },
        {
          messageId: "functionOverload",
        },
      ],
    },
    {
      name: "disallows overloads in same scope",
      code: `
        export function transform(input: string): string;
        export function transform(input: number): string;
        export function transform(input: string | number): string {
          return String(input);
        }

        export function format(x: Date): string;
        export function format(x: number): string;
        export function format(x: Date | number): string {
          return x instanceof Date ? x.toISOString() : new Date(x).toISOString();
        }
      `,
      errors: [
        {
          messageId: "functionOverload",
        },
        {
          messageId: "functionOverload",
        },
        {
          messageId: "functionOverload",
        },
        {
          messageId: "functionOverload",
        },
        {
          messageId: "functionOverload",
        },
        {
          messageId: "functionOverload",
        },
      ],
    },
  ],
});
