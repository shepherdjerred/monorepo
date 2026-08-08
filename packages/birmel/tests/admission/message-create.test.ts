import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("Birmel 3.0 Discord admission", () => {
  test("passes the isolated admission contract suite", async () => {
    const child = Bun.spawn(
      ["bun", "test", "./tests/admission/message-create-harness.ts"],
      {
        cwd: packageRoot,
        env: Bun.env,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    const output = `${stdout}\n${stderr}`;
    expect(exitCode, output).toBe(0);
    expect(output).toContain("6 pass");
    expect(output).toContain("0 fail");
  });
});
