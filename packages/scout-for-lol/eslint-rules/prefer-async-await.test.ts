import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "bun:test";
import { preferAsyncAwait } from "./prefer-async-await";

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

ruleTester.run("prefer-async-await", preferAsyncAwait, {
  valid: [
    {
      name: "allows async/await",
      code: `async function fetchData() { const result = await fetch('/api'); return result; }`,
    },
    {
      name: "allows try/catch with async/await",
      code: `async function fetchData() { try { const result = await fetch('/api'); return result; } catch (error) { console.error(error); } }`,
    },
    {
      name: "allows Promise.resolve static method",
      code: `const value = Promise.resolve(42);`,
    },
    {
      name: "allows Promise.reject static method",
      code: `const error = Promise.reject(new Error('failed'));`,
    },
    {
      name: "allows Promise.all",
      code: `async function fetchAll() { const results = await Promise.all([fetch('/a'), fetch('/b')]); return results; }`,
    },
    {
      name: "allows Promise.race",
      code: `async function fetchFirst() { const result = await Promise.race([fetch('/a'), fetch('/b')]); return result; }`,
    },
    {
      name: "allows await with .catch() for default error handling",
      code: `async function fetchData() { const result = await fetch('/api').catch(() => null); return result; }`,
    },
    {
      name: "allows await with .then() chained",
      code: `async function fetchData() { const result = await fetch('/api').then(r => r.json()); return result; }`,
    },
    {
      name: "allows Promise.resolve().then() inline pattern",
      code: `Promise.resolve(42).then(x => console.log(x));`,
    },
    {
      name: "allows Promise.reject().catch() inline pattern",
      code: `Promise.reject(new Error('test')).catch(e => console.error(e));`,
    },
  ],
  invalid: [
    {
      name: "disallows .then() on promise",
      code: `fetch('/api').then(response => response.json());`,
      errors: [
        {
          messageId: "preferAsyncAwait",
        },
      ],
    },
    {
      name: "disallows .catch() on promise",
      code: `fetch('/api').catch(error => console.error(error));`,
      errors: [
        {
          messageId: "preferTryCatch",
        },
      ],
    },
    {
      name: "disallows .finally() on promise",
      code: `fetch('/api').finally(() => cleanup());`,
      errors: [
        {
          messageId: "preferAwait",
        },
      ],
    },
    {
      name: "disallows chained .then().catch()",
      code: `fetch('/api').then(r => r.json()).catch(e => console.error(e));`,
      errors: [
        {
          messageId: "preferTryCatch",
        },
        {
          messageId: "preferAsyncAwait",
        },
      ],
    },
    {
      name: "disallows .then() on variable holding promise",
      code: `const promise = fetch('/api'); promise.then(r => console.log(r));`,
      errors: [
        {
          messageId: "preferAsyncAwait",
        },
      ],
    },
    {
      name: "disallows .then() in nested function",
      code: `function getData() { return fetch('/api').then(r => r.json()); }`,
      errors: [
        {
          messageId: "preferAsyncAwait",
        },
      ],
    },
    {
      name: "disallows multiple chained .then() calls",
      code: `fetch('/api').then(r => r.json()).then(data => process(data));`,
      errors: [
        {
          messageId: "preferAsyncAwait",
        },
        {
          messageId: "preferAsyncAwait",
        },
      ],
    },
  ],
});
