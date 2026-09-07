const turboTasks = [
  "build",
  "typecheck",
  "test:ci",
  "coverage:portable",
  "lint",
  "check-suppressions",
  "check-agent-guidance",
  "check-directory-file-counts",
  "check-ai-architecture",
  "check-floating-deps",
  "check-patched-deps",
  "check-ci-env",
  "check-worker-image-pins",
  "check-script-migrations",
  "check-test-standardization",
  "script-coverage",
  "markdownlint",
  "prettier-scout",
  "prettier-homelab",
  "prettier-packages",
  "prettier-root",
  "shellcheck",
  "hadolint",
  "knip",
  "gitleaks",
  "jscpd",
  "quality-ratchet",
  "compliance-check",
  "lockfile-check",
  "merge-conflicts",
  "env-var-names",
  "line-endings-scout",
  "line-endings-homelab",
  "line-endings-packages",
  "line-endings-root",
  "react-version-sync",
  "large-files-scout",
  "large-files-homelab",
  "large-files-packages",
  "large-files-root",
  "scout-asset-sizes",
  "guard:migration",
  "ruff",
  "pyright",
  "tunnel-dns-coverage",
  "check:talos",
  "lint:helm",
  "lint:tofu",
  "check:kubeconform",
  "check:1password",
  "check:ios-native-deps",
  "check:release-bundle",
  "lint:swift",
  "check:caddyfile",
  "test:contract",
] as const;

type GitValidator = (command: readonly string[]) => Promise<number>;
type ChangedFilesReader = (
  base: string,
) => Promise<readonly string[] | undefined>;

async function validateBaseWithGit(
  command: readonly string[],
): Promise<number> {
  const child = Bun.spawn([...command], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "inherit",
  });
  return child.exited;
}

async function readChangedFilesWithGit(
  base: string,
): Promise<readonly string[] | undefined> {
  const child = Bun.spawn(
    ["git", "diff", "--no-renames", "--name-only", base, "HEAD"],
    {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "inherit",
    },
  );
  const [exitCode, output] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
  ]);
  if (exitCode !== 0) return undefined;
  return output.split("\n").filter((path) => path !== "");
}

function rootScriptsInputsChanged(changedFiles: readonly string[]): boolean {
  return changedFiles.some(
    (path) => path === ".buildkite" || path.startsWith(".buildkite/"),
  );
}

export async function affectedVerifyFilters(
  environment: Readonly<Record<string, string | undefined>>,
  validate: GitValidator = validateBaseWithGit,
  readChangedFiles: ChangedFilesReader = readChangedFilesWithGit,
): Promise<string[]> {
  if (environment["CI_IO_FIXED_CORPUS"] === "true") return [];
  const base = environment["CI_CHANGED_BASE"]?.trim();
  if (base === undefined || base === "") return [];
  const checks = [
    ["git", "cat-file", "-e", `${base}^{commit}`],
    ["git", "merge-base", "--is-ancestor", base, "HEAD"],
  ] as const;
  for (const command of checks) {
    if ((await validate(command)) !== 0) {
      console.error(
        `WARN: CI changed-file base ${base} is invalid; running full verification`,
      );
      return [];
    }
  }
  const changedFiles = await readChangedFiles(base);
  if (changedFiles === undefined) {
    console.error(
      `WARN: could not read changed files from CI base ${base}; running full verification`,
    );
    return [];
  }
  // The affected package graph and the root namespace are a union. Root checks
  // remain represented, but Turbo executes only the ones whose declared input
  // hashes changed. Package tasks cover changed workspaces plus reverse
  // dependents and their task dependencies.
  const filters = [`--filter=...[${base}]`, "--filter=//"];
  if (rootScriptsInputsChanged(changedFiles)) {
    filters.push("--filter=@shepherdjerred/root-scripts");
  }
  return filters;
}

export async function main(
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): Promise<number> {
  const forwardedArgs = process.argv
    .slice(2)
    .filter((argument) => argument !== "--");
  const affectedFilters = await affectedVerifyFilters(environment);
  const turbo = Bun.spawn(
    [
      "bun",
      "x",
      "--no-install",
      "turbo",
      "run",
      ...turboTasks,
      "--continue",
      ...affectedFilters,
      ...forwardedArgs,
    ],
    {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      env: environment,
    },
  );
  const turboExitCode = await turbo.exited;
  if (turboExitCode !== 0) return turboExitCode;

  const designTokenCheck = Bun.spawn(
    [
      "bun",
      "--no-install",
      "run",
      "--cwd",
      "packages/scout-for-lol/packages/design-audit",
      "check:tokens",
    ],
    {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      env: environment,
    },
  );
  const designTokenExitCode = await designTokenCheck.exited;
  if (designTokenExitCode !== 0) return designTokenExitCode;

  const analyticsCheck = Bun.spawn(
    ["bun", "--no-install", "scripts/checks/check-analytics-sites.ts"],
    {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      env: environment,
    },
  );
  return analyticsCheck.exited;
}

if (import.meta.main) process.exitCode = await main();
