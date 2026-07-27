import { expect, test } from "bun:test";

test("migrated entrypoints load without executing", async () => {
  const modules = await Promise.all([
    import("./create-minimal-png.ts"),
    import("./dev-web.ts"),
    import("./install-pkgs.ts"),
  ]);
  expect(modules).toHaveLength(3);
});
