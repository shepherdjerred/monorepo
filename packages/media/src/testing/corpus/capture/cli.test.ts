import { expect, test } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const packageRoot = fileURLToPath(new URL("../../../../", import.meta.url));
async function command(args: string[]) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(
        "bun",
        ["--no-install", "scripts/corpus/capture.ts", ...args],
        {
          cwd: packageRoot,
          stdio: ["ignore", "pipe", "pipe"],
          signal: AbortSignal.timeout(3000),
        },
      );
      let stdout = "",
        stderr = "";
      child.stdout.setEncoding("utf8").on("data", (value: string) => {
        stdout += value;
      });
      child.stderr.setEncoding("utf8").on("data", (value: string) => {
        stderr += value;
      });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout, stderr }));
    },
  );
}
test("actual capture CLI rejects incomplete arguments without exposing input or reading credentials", async () => {
  const result = await command(["--recyclarr-reference", "do-not-print-this"]);
  expect(result.code).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("Private installed capture failed");
  expect(result.stderr).not.toContain("do-not-print-this");
});
test("actual capture CLI refuses an in-worktree output before credential lookup", async () => {
  const result = await command([
    "--directory",
    path.join(packageRoot, "private-capture"),
    "--recyclarr-reference",
    "this-reference-must-not-be-read",
    "--radarr-url",
    "http://127.0.0.1:17878",
    "--sonarr-url",
    "http://127.0.0.1:18989",
  ]);
  expect(result.code).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("Private installed capture failed");
  expect(result.stderr).not.toContain("this-reference-must-not-be-read");
});
