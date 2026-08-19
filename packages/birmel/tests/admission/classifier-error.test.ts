import { expect, test } from "bun:test";

test("passes the isolated classifier error metrics contract", async () => {
  const process = Bun.spawn(
    ["bun", "test", "./tests/admission/classifier-error-harness.ts"],
    {
      cwd: new URL("../../", import.meta.url).pathname,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  expect({ exitCode, stdout, stderr }).toMatchObject({ exitCode: 0 });
}, 30_000);
