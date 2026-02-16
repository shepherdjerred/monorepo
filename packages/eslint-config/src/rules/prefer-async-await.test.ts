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
    { code: `async function fetchData() { const result = await fetch('/api'); return result; }` },
    {
      code: `async function fetchData() { try { const result = await fetch('/api'); return result; } catch (error) { console.error(error); } }`,
    },
    { code: `const value = Promise.resolve(42);` },
    { code: `const error = Promise.reject(new Error('failed'));` },
    { code: `async function fetchAll() { const results = await Promise.all([fetch('/a'), fetch('/b')]); return results; }` },
    { code: `async function fetchFirst() { const result = await Promise.race([fetch('/a'), fetch('/b')]); return result; }` },
    { code: `async function fetchData() { const result = await fetch('/api').catch(() => null); return result; }` },
    { code: `async function fetchData() { const result = await fetch('/api').then(r => r.json()); return result; }` },
    { code: `Promise.resolve(42).then(x => console.log(x));` },
    { code: `Promise.reject(new Error('test')).catch(e => console.error(e));` },
  ],
  invalid: [
    { code: `fetch('/api').then(response => response.json());`, errors: [{ messageId: "preferAsyncAwait" }] },
    { code: `fetch('/api').catch(error => console.error(error));`, errors: [{ messageId: "preferTryCatch" }] },
    { code: `fetch('/api').finally(() => cleanup());`, errors: [{ messageId: "preferAwait" }] },
    {
      code: `fetch('/api').then(r => r.json()).catch(e => console.error(e));`,
      errors: [{ messageId: "preferTryCatch" }, { messageId: "preferAsyncAwait" }],
    },
    { code: `const promise = fetch('/api'); promise.then(r => console.log(r));`, errors: [{ messageId: "preferAsyncAwait" }] },
    { code: `function getData() { return fetch('/api').then(r => r.json()); }`, errors: [{ messageId: "preferAsyncAwait" }] },
    {
      code: `fetch('/api').then(r => r.json()).then(data => process(data));`,
      errors: [{ messageId: "preferAsyncAwait" }, { messageId: "preferAsyncAwait" }],
    },
  ],
});
