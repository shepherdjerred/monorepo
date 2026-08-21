import { expect, test } from "vitest";

test("installer entrypoint loads without installing", async () => {
  const module = await import("./install.ts");
  expect(module).toBeDefined();
});
