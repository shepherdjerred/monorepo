import { expect, test } from "bun:test";

test("migration entrypoints load without running", async () => {
  const modules = await Promise.all([
    import("./build-wasm.ts"),
    import("./vendor-n64wasm.ts"),
  ]);
  expect(modules).toHaveLength(2);
  expect(modules.every((module) => typeof module === "object")).toBe(true);
});
