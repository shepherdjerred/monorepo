import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  MISSING_LEFTHOOK_MESSAGE,
  resolveWorktreeLefthookBinary,
  runLefthook,
} from "./run-lefthook.ts";

describe("run-lefthook", () => {
  let tempDir = "";

  afterEach(async () => {
    if (tempDir !== "") {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  test("prefers the active worktree node_modules/.bin/lefthook over PATH", async () => {
    const resolved = await resolveWorktreeLefthookBinary({
      cwd: "/worktrees/feature-a/packages/foo",
      platform: "darwin",
      resolveToplevel: () => "/worktrees/feature-a",
      fileExists: (candidate) =>
        candidate === "/worktrees/feature-a/node_modules/.bin/lefthook",
      which: () => "/usr/local/bin/lefthook",
    });
    expect(resolved).toBe("/worktrees/feature-a/node_modules/.bin/lefthook");
  });

  test("checks Windows .exe/.cmd shims before falling back to PATH", async () => {
    const resolved = await resolveWorktreeLefthookBinary({
      cwd: String.raw`C:\repo`,
      platform: "win32",
      resolveToplevel: () => String.raw`C:\repo`,
      fileExists: (candidate) => candidate.endsWith("lefthook.cmd"),
      which: () => null,
    });
    expect(resolved).toContain("lefthook.cmd");
  });

  test("falls back to PATH when worktree node_modules/.bin/lefthook is absent", async () => {
    const resolved = await resolveWorktreeLefthookBinary({
      cwd: "/worktrees/fresh",
      platform: "darwin",
      resolveToplevel: () => "/worktrees/fresh",
      fileExists: () => false,
      which: () => "/opt/homebrew/bin/lefthook",
    });
    expect(resolved).toBe("/opt/homebrew/bin/lefthook");
  });

  test("acknowledges hook -h probe and fails fast with actionable message on hook execution when missing", async () => {
    const errors: string[] = [];
    const missingOptions = {
      cwd: "/worktrees/fresh",
      platform: "darwin" as const,
      resolveToplevel: () => "/worktrees/fresh",
      fileExists: () => false,
      which: () => null,
      writeStderr: (message: string) => {
        errors.push(message);
      },
    };

    expect(await runLefthook(["-h"], missingOptions)).toBe(0);
    expect(errors).toEqual([]);

    expect(await runLefthook(["run", "pre-commit"], missingOptions)).toBe(1);
    expect(errors).toEqual([`${MISSING_LEFTHOOK_MESSAGE}\n`]);
  });

  test("forwards arguments and exit status to the resolved lefthook binary", async () => {
    const invocations: { binary: string; args: readonly string[] }[] = [];
    const code = await runLefthook(["run", "pre-commit", "--no-tty"], {
      cwd: "/worktrees/active",
      platform: "darwin",
      resolveToplevel: () => "/worktrees/active",
      fileExists: () => true,
      which: () => null,
      spawnBinary: (binary, args) => {
        invocations.push({ binary, args });
        return Promise.resolve(0);
      },
    });
    expect(code).toBe(0);
    expect(invocations).toEqual([
      {
        binary: "/worktrees/active/node_modules/.bin/lefthook",
        args: ["run", "pre-commit", "--no-tty"],
      },
    ]);
  });

  test("generated hook template never falls through to go tool lefthook in an uninstalled worktree", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "lefthook-wrapper-"));
    const init = Bun.spawnSync(["git", "init", "--quiet"], { cwd: tempDir });
    expect(init.exitCode).toBe(0);

    const wrapperScript = path.resolve(import.meta.dirname, "run-lefthook.ts");
    const hookCheck = [
      `if bun ${JSON.stringify(wrapperScript)} -h >/dev/null 2>&1; then`,
      `  bun ${JSON.stringify(wrapperScript)} run pre-commit`,
      "else",
      '  echo "FELL_THROUGH_TO_GO_TOOL" >&2',
      "  exit 99",
      "fi",
    ].join("\n");

    const bunDir = path.dirname(process.execPath);
    const gitBin = Bun.which("git");
    const gitDir = gitBin === null ? "/usr/bin" : path.dirname(gitBin);
    const result = Bun.spawnSync(["/bin/sh", "-c", hookCheck], {
      cwd: tempDir,
      env: {
        PATH: `${bunDir}:${gitDir}:/bin`,
        HOME: tempDir,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(1);
    const stderr = new TextDecoder().decode(result.stderr);
    expect(stderr).toContain(MISSING_LEFTHOOK_MESSAGE);
    expect(stderr).not.toContain("FELL_THROUGH_TO_GO_TOOL");
  });

  test("executes the active worktree lefthook binary via default git-toplevel and spawn helpers", async () => {
    const code = await runLefthook(["version"]);
    expect(code).toBe(0);
  });
});
