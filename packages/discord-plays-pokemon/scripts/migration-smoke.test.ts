import { expect, test } from "bun:test";

test("migration entrypoint loads without running", async () => {
  const module = await import("./build-wasm.ts");
  expect(typeof module).toBe("object");
});
