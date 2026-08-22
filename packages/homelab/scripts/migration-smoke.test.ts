import { expect, test } from "vitest";

test("migration entrypoints load without running", async () => {
  const modules = await Promise.all([
    import("./helm-set-version.ts"),
    import("./lint-helm.ts"),
    import("./velero-backups.ts"),
  ]);
  expect(modules).toHaveLength(3);
  expect(modules.every((module) => typeof module === "object")).toBe(true);
});
