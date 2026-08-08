const turboTasks = [
  "build",
  "typecheck",
  "test:ci",
  "lint",
  "check-todos",
  "check-suppressions",
  "check-patched-deps",
  "check-script-migrations",
  "script-coverage",
  "markdownlint",
  "prettier",
  "shellcheck",
  "knip",
  "gitleaks",
  "jscpd",
  "quality-ratchet",
  "compliance-check",
  "lockfile-check",
  "merge-conflicts",
  "env-var-names",
  "line-endings",
  "react-version-sync",
  "large-files",
  "guard:migration",
  "ruff",
  "pyright",
  "tunnel-dns-coverage",
  "check:talos",
  "lint:helm",
  "check:1password",
  "check:test-template",
  "check:ios-native-deps",
  "check:release-bundle",
  "lint:swift",
  "check:caddyfile",
  "test:contract",
  "check:rehearsal",
] as const;

const forwardedArgs = process.argv
  .slice(2)
  .filter((argument) => argument !== "--");
const turbo = Bun.spawn(
  [
    "bunx",
    "--no-install",
    "turbo",
    "run",
    ...turboTasks,
    "--continue",
    ...forwardedArgs,
  ],
  { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
);
const turboExitCode = await turbo.exited;
if (turboExitCode !== 0) process.exit(turboExitCode);

const analyticsCheck = Bun.spawn(["bun", "scripts/check-analytics-sites.ts"], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await analyticsCheck.exited);
