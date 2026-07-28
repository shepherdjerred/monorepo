import { expect, test } from "bun:test";

test("git cleanup entrypoint loads without running", async () => {
  const module = await import("../bin/executable_git_cleanup.ts");
  expect(typeof module).toBe("object");
});
