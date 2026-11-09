#!/usr/bin/env bun

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { spawn } from "node:child_process";

type GitValidator = (command: readonly string[]) => Promise<number>;
type ChangedFilesReader = (
  base: string,
) => Promise<readonly string[] | undefined>;

const FULL_TREE_SCAN_INPUTS = new Set([".gitleaks.toml", ".mise.toml"]);

async function validate(command: readonly string[]): Promise<number> {
  const child = Bun.spawn([...command], {
    stdout: "ignore",
    stderr: "inherit",
  });
  return child.exited;
}

async function readChangedFiles(
  base: string,
): Promise<readonly string[] | undefined> {
  const child = Bun.spawn(
    ["git", "diff", "--no-renames", "--name-only", base, "HEAD"],
    { stdout: "pipe", stderr: "inherit" },
  );
  const [exitCode, output] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
  ]);
  return exitCode === 0
    ? output.split("\n").filter((path) => path !== "")
    : undefined;
}

function fullTreeScanCommand(): string[] {
  return [
    "gitleaks",
    "detect",
    "--source",
    ".",
    "--no-git",
    "--redact",
    "--verbose",
    "--no-banner",
  ];
}

// CI tasks share a checkout and create ignored outputs in parallel. Archive HEAD
// so the full scan covers exactly the source that this pipeline verifies.
export async function createTrackedSnapshot(
  repository: string,
): Promise<string> {
  const snapshot = await mkdtemp(nodePath.join(tmpdir(), "gitleaks-source-"));
  try {
    const exitCode = await new Promise<number>((resolve, reject) => {
      const archive = spawn(
        "bash",
        [
          "-o",
          "pipefail",
          "-c",
          'git archive HEAD | tar -xf - -C "$1"',
          "bash",
          snapshot,
        ],
        { cwd: repository, stdio: "inherit" },
      );
      archive.once("error", reject);
      archive.once("exit", (code) => {
        if (code === null) {
          resolve(1);
        } else {
          resolve(code);
        }
      });
    });
    if (exitCode !== 0) {
      throw new Error(
        "Could not archive the committed source tree for gitleaks",
      );
    }
    return snapshot;
  } catch (error) {
    await rm(snapshot, { recursive: true, force: true });
    throw error;
  }
}

export async function gitleaksCommand(
  environment: Readonly<Record<string, string | undefined>>,
  validator: GitValidator = validate,
  changedFilesReader: ChangedFilesReader = readChangedFiles,
): Promise<string[]> {
  const base = environment["CI_CHANGED_BASE"]?.trim();
  if (base !== undefined && base !== "") {
    const checks = [
      ["git", "cat-file", "-e", `${base}^{commit}`],
      ["git", "merge-base", "--is-ancestor", base, "HEAD"],
    ] as const;
    let valid = true;
    for (const command of checks) {
      if ((await validator(command)) !== 0) valid = false;
    }
    if (valid) {
      const changedFiles = await changedFilesReader(base);
      if (
        changedFiles === undefined ||
        changedFiles.some((path) => FULL_TREE_SCAN_INPUTS.has(path))
      ) {
        return fullTreeScanCommand();
      }
      return [
        "gitleaks",
        "git",
        `--log-opts=${base}..HEAD`,
        "--redact",
        "--verbose",
        "--no-banner",
        ".",
      ];
    }
    console.error(
      `WARN: gitleaks could not validate ${base}; scanning the complete tree`,
    );
  }
  return fullTreeScanCommand();
}

async function main(): Promise<number> {
  const command = await gitleaksCommand(Bun.env);
  const fullTreeScan = command[1] === "detect";
  const ci = Bun.env["CI"];
  const snapshot =
    fullTreeScan && ci !== undefined && ci !== ""
      ? await createTrackedSnapshot(process.cwd())
      : undefined;
  try {
    const child = Bun.spawn(command, {
      cwd: snapshot ?? process.cwd(),
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      env: Bun.env,
    });
    return await child.exited;
  } finally {
    if (snapshot !== undefined) {
      await rm(snapshot, { recursive: true, force: true });
    }
  }
}

if (import.meta.main) process.exitCode = await main();
