#!/usr/bin/env bun

type GitValidator = (command: readonly string[]) => Promise<number>;

async function validate(command: readonly string[]): Promise<number> {
  const child = Bun.spawn([...command], {
    stdout: "ignore",
    stderr: "inherit",
  });
  return child.exited;
}

export async function gitleaksCommand(
  environment: Readonly<Record<string, string | undefined>>,
  validator: GitValidator = validate,
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
