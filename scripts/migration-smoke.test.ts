import { expect, test } from "bun:test";

test("root migration entrypoints load without running", async () => {
  const modules = await Promise.all([
    import("./generate-anki.ts"),
    import("./check-env-var-names.ts"),
    import("./check-merge-conflicts.ts"),
    import("./compliance-check.ts"),
    import("./new-package.ts"),
    import("./prettier-staged.ts"),
    import("./pyright-check.ts"),
    import("./shellcheck.ts"),
  ]);
  expect(modules).toHaveLength(8);
  expect(modules.every((module) => typeof module === "object")).toBe(true);
});
