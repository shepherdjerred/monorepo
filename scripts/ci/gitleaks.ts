#!/usr/bin/env bun

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
  if (exitCode !== 0) return undefined;
  return output.split("\n").filter((path) => path !== "");
}

function fullTreeScanCommand(): string[] {
  return [
    "gitleaks",
    "detect",
    "--source",
    ".",
    "--no-git",
    "--redact",
    "--no-banner",
  ];
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
  const child = Bun.spawn(command, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: Bun.env,
  });
  return child.exited;
}

if (import.meta.main) process.exitCode = await main();
