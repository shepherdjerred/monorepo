import { describe, expect, test } from "vitest";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("Birmel 3.0 Discord admission", () => {
  test("passes the isolated admission contract suite", async () => {
    const child = Bun.spawn(
      [
        "bun",
        "--no-install",
        "--bun",
        "vitest",
        "--config",
        "../../vitest.config.ts",
        "run",
      ],
      {
        cwd: packageRoot,
        env: {
          ...Bun.env,
          BIRMEL_VITEST_HARNESS: "tests/admission/message-create-harness.ts",
        },
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
    expect(output).toContain("11 passed");
  }, 30_000);
});
