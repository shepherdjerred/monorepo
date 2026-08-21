import { expect, test } from "vitest";

test("git cleanup entrypoint loads without running", async () => {
  const module = await import("../bin/executable_git_cleanup.ts");
  expect(typeof module).toBe("object");
});
