import { expect, test } from "bun:test";

test("installer entrypoint loads without installing", async () => {
  const module = await import("./install.ts");
  expect(module).toBeDefined();
});
