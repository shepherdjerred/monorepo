import { expect, test } from "bun:test";

test("E2E entrypoints load without starting containers", async () => {
  const modules = await Promise.all([
    import("./run-ci.ts"),
    import("./run.ts"),
  ]);
  expect(modules).toHaveLength(2);
});
