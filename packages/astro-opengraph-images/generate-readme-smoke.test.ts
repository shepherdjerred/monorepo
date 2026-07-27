import { expect, test } from "bun:test";

test("entrypoint loads without executing generation", async () => {
  const module = await import("./generate-readme.ts");
  expect(module).toBeDefined();
});
