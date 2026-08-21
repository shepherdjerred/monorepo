import { expect, test } from "vitest";

test("iOS script entrypoints load without executing", async () => {
  const modules = await Promise.all([
    import("./clean-ios.ts"),
    import("./ios-logs.ts"),
  ]);
  expect(modules).toHaveLength(2);
});
