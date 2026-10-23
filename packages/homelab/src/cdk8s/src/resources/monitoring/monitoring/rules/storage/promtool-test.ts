import { expect } from "vitest";

/** Runs `promtool test rules` on a written unit-test file and asserts it passed. */
export async function expectPromtoolRulesPass(testFile: string): Promise<void> {
  const child = Bun.spawn(["promtool", "test", "rules", testFile], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(exitCode, stdout + stderr).toBe(0);
}
