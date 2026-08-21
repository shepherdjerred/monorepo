import { expect, test } from "vitest";

test("passes the isolated classifier error metrics contract", async () => {
  const process = Bun.spawn(
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
      cwd: new URL("../../", import.meta.url).pathname,
      env: {
        ...Bun.env,
        BIRMEL_VITEST_HARNESS: "tests/admission/classifier-error-harness.ts",
      },
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
