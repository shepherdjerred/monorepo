import { afterEach, describe, expect, test } from "bun:test";

import { optionalEnv, requireEnv, run, runAllowExit, tmpBase } from "./run.ts";
import { isTransientError } from "./transient.ts";

/**
 * Spawn a short Bun one-liner (via the same interpreter running the tests) that
 * writes `payload` to stderr and exits with `code`. Using `process.execPath`
 * avoids depending on `bun` being on PATH in the test environment.
 */
function stderrEmitter(payload: string, code: number): string[] {
  return [
    process.execPath,
    "-e",
    `process.stderr.write(${JSON.stringify(payload)}); process.exit(${String(code)});`,
  ];
}

const testEnvironmentName = "CODEX_RUN_HELPER_TEST_VALUE";

describe("run stderr capture", () => {
  const originalWrite = process.stderr.write.bind(process.stderr);
  afterEach(() => {
    process.stderr.write = originalWrite;
    Bun.env[testEnvironmentName] = undefined;
  });

  test("runAllowExit returns a stderr tail and never throws on non-zero exit", async () => {
    // Silence live forwarding so the child's stderr doesn't pollute test output.
    process.stderr.write = () => true;
    const result = await runAllowExit(stderrEmitter("boom on stderr\n", 3));
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("boom on stderr");
    expect(result.stdout).toBe("");
  });

  test("run() embeds the stderr tail in the thrown error", async () => {
    process.stderr.write = () => true;
    let caught: unknown;
    try {
      await run(stderrEmitter("something on stderr\n", 1));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught instanceof Error ? caught.message : "").toContain(
      "something on stderr",
    );
  });

  test("a subprocess 503 on stderr is classified transient end-to-end", async () => {
    // The load-bearing case: release-please prints a GitHub 503 to stderr then
    // exits 1. Without the stderr tail in the thrown error, isTransientError
    // sees only "Command failed (exit 1): <cmd>" and the build hard-fails
    // instead of retrying (build 5864).
    process.stderr.write = () => true;
    const payload =
      "HttpError: No server is currently available to service your request.\n  status: 503\n";
    let caught: unknown;
    try {
      await run(stderrEmitter(payload, 1));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(isTransientError(caught)).toBe(true);
  });

  test("a non-transient subprocess error stays a hard failure", async () => {
    // tofu's BucketAlreadyExists (build 5864) must NOT be misread as transient —
    // a real config error has to keep exiting 1.
    process.stderr.write = () => true;
    const payload =
      "Error: creating S3 Bucket (scout-site-releases): BucketAlreadyExists\n";
    let caught: unknown;
    try {
      await run(stderrEmitter(payload, 1));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught instanceof Error ? caught.message : "").toContain(
      "BucketAlreadyExists",
    );
    expect(isTransientError(caught)).toBe(false);
  });

  test("forwards stderr live to the parent while capturing it", async () => {
    let forwarded = "";
    process.stderr.write = (chunk: string | Uint8Array): boolean => {
      forwarded +=
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    };
    const result = await runAllowExit(
      stderrEmitter("live-forwarded-line\n", 0),
    );
    process.stderr.write = originalWrite;
    expect(forwarded).toContain("live-forwarded-line");
    expect(result.stderr).toContain("live-forwarded-line");
  });

  test("removes explicitly unset environment variables after layering env", async () => {
    const result = await runAllowExit(
      [
        process.execPath,
        "-e",
        'process.stdout.write(process.env["REFINER_TEST_SECRET"] === undefined ? "unset" : "present");',
      ],
      {
        capture: true,
        secret: true,
        env: { REFINER_TEST_SECRET: "must-not-reach-child" },
        unsetEnv: ["REFINER_TEST_SECRET"],
      },
    );
    expect(result.stdout).toBe("unset");
  });

  test("large stderr is drained concurrently (no pipe-buffer deadlock) and the tail is bounded", async () => {
    // Emit far more than the OS pipe buffer (~64KiB) to prove the concurrent
    // drain in teeStderr keeps the child from blocking. The retained tail must
    // stay bounded and hold the MOST RECENT output (the end marker).
    process.stderr.write = () => true;
    // The child GENERATES the 200KB itself so the command line (echoed in the
    // error) stays short — otherwise the message length reflects the embedded
    // payload, not the bounded tail we're asserting on.
    const cmd = [
      process.execPath,
      "-e",
      `process.stderr.write("x".repeat(200000)); process.stderr.write("END_MARKER"); process.exit(1);`,
    ];
    let caught: unknown;
    try {
      await run(cmd);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = caught instanceof Error ? caught.message : "";
    expect(message).toContain("END_MARKER");
    // Tail is bounded well under the full 200KB payload.
    expect(message.length).toBeLessThan(20_000);
  });
});

test("requires and optionally reads environment variables", () => {
  Bun.env[testEnvironmentName] = undefined;
  expect(() => requireEnv(testEnvironmentName)).toThrow(
    `Missing required environment variable ${testEnvironmentName}`,
  );
  expect(optionalEnv(testEnvironmentName)).toBeNull();

  Bun.env[testEnvironmentName] = "value";
  expect(requireEnv(testEnvironmentName)).toBe("value");
  expect(optionalEnv(testEnvironmentName)).toBe("value");
  Bun.env[testEnvironmentName] = "";
  expect(optionalEnv(testEnvironmentName)).toBeNull();
  Bun.env[testEnvironmentName] = undefined;
});

test("returns the temporary base without a trailing slash", () => {
  expect(tmpBase()).toBe((Bun.env["TMPDIR"] ?? "/tmp").replace(/\/+$/u, ""));
});

test("covers command environment, cwd, success, and empty command paths", async () => {
  Bun.env[testEnvironmentName] = "secret-value";
  const result = await runAllowExit(
    [
      process.execPath,
      "-e",
      `process.stdout.write(process.env[${JSON.stringify(testEnvironmentName)}] ?? "missing"); process.stderr.write("diagnostic")`,
    ],
    {
      capture: true,
      cwd: "/tmp",
      env: { [testEnvironmentName]: "override-value" },
      unsetEnv: [testEnvironmentName],
    },
  );
  expect(result.stdout).toBe("missing");
  expect(result.stderr).toBe("diagnostic");
  await expect(runAllowExit([])).rejects.toThrow("run: empty command");
  await expect(
    run([process.execPath, "-e", "process.exit(0)"]),
  ).resolves.toMatchObject({ exitCode: 0 });
});
