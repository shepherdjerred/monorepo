import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

test("BlueMap migration preserves renders, resumes interruptions, and fences cleanup", async () => {
  const result = Bun.spawn(
    [
      "python3",
      "-m",
      "unittest",
      "discover",
      "-s",
      fileURLToPath(new URL("bluemap-storage/", import.meta.url)),
      "-p",
      "test_bluemap.py",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [code, stdout, stderr] = await Promise.all([
    result.exited,
    new Response(result.stdout).text(),
    new Response(result.stderr).text(),
  ]);
  expect(code, stdout + stderr).toBe(0);
});
