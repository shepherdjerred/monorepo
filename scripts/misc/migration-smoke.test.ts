import { expect, test } from "vitest";

test("root migration entrypoints load without running", async () => {
  const modules = await Promise.all([
    import("./generate-anki.ts"),
    import("../checks/check-env-var-names.ts"),
    import("../checks/check-merge-conflicts.ts"),
    import("../checks/compliance-check.ts"),
    import("./new-package.ts"),
    import("../tools/prettier-staged.ts"),
    import("../tools/pyright-check.ts"),
    import("../tools/shellcheck.ts"),
    import("../tools/hadolint.ts"),
  ]);
  expect(modules).toHaveLength(9);
  expect(modules.every((module) => typeof module === "object")).toBe(true);
});
