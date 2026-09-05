// Lints .buildkite/scripts with the root-scripts ESLint config. A separate
// entry point (instead of a second CLI invocation in the lint script) because
// flat-config file patterns resolve against the process cwd: linting a
// directory OUTSIDE the scripts workspace requires cwd = repo root. The CLI is
// spawned with that cwd (rather than using the ESLint API) so the bulk-
// suppressions lifecycle — apply, fail on new violations, fail on stale
// entries until `--prune-suppressions` — matches every other package's lint.
// Extra CLI arguments (e.g. --suppress-rule, --prune-suppressions) forward.
const repoRoot = new URL("../..", import.meta.url).pathname;

const proc = Bun.spawn(
  [
    `${repoRoot}scripts/node_modules/.bin/eslint`,
    "--config",
    "scripts/eslint.config.ts",
    "--cache",
    "--cache-location",
    "scripts/.eslintcache-buildkite",
    "--suppressions-location",
    ".buildkite/eslint-suppressions.json",
    ".buildkite/scripts",
    ...process.argv.slice(2),
  ],
  { cwd: repoRoot, stdout: "inherit", stderr: "inherit" },
);
process.exitCode = await proc.exited;
