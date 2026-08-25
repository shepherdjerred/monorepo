import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const repositoryRoot = path.join(import.meta.dir, "../..");
const hookPath = path.join(repositoryRoot, ".buildkite/hooks/pre-command");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

async function fakeAgentDirectory(script: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "ci-redactor-hook-"));
  temporaryDirectories.push(directory);
  const executable = path.join(directory, "buildkite-agent");
  await writeFile(executable, script);
  await chmod(executable, 0o755);
  return directory;
}

describe("Buildkite credential redaction hook", () => {
  test("registers a granted command-container value without printing it", async () => {
    const secretFixture = "fixture-credential-value";
    const executableDirectory = await fakeAgentDirectory(String.raw`#!/bin/sh
set -eu
test "$1" = "redactor"
test "$2" = "add"
test "$3" = "--format=none"
value=$(cat)
test "$value" = "$EXPECTED_REDACTION_VALUE"
printf 'registered\n'
`);

    const process = Bun.spawn(["sh", hookPath], {
      cwd: repositoryRoot,
      env: {
        PATH: `${executableDirectory}:/usr/bin:/bin`,
        BUILDKITE_BUILD_CHECKOUT_PATH: repositoryRoot,
        EXPECTED_REDACTION_VALUE: secretFixture,
        NPM_TOKEN: secretFixture,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toBe("registered\n");
    expect(stderr).toBe("");
    expect(stdout).not.toContain(secretFixture);
    expect(stderr).not.toContain(secretFixture);
  });

  test("fails closed when the redactor rejects a value", async () => {
    const executableDirectory = await fakeAgentDirectory(`#!/bin/sh
exit 17
`);
    const process = Bun.spawn(["sh", hookPath], {
      cwd: repositoryRoot,
      env: {
        PATH: `${executableDirectory}:/usr/bin:/bin`,
        BUILDKITE_BUILD_CHECKOUT_PATH: repositoryRoot,
        NPM_TOKEN: "fixture-credential-value",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(await process.exited).not.toBe(0);
  });
});
