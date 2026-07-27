// Lints .buildkite/scripts with the root-scripts ESLint config. A separate
// entry point (instead of a second CLI invocation in the lint script) because
// flat-config file patterns resolve against the process cwd: linting a
// directory OUTSIDE the scripts workspace requires cwd = repo root, and the
// ESLint API is the clean way to get that without cd/path gymnastics.
import { ESLint } from "eslint";

const repoRoot = new URL("..", import.meta.url).pathname;

const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: `${repoRoot}scripts/eslint.config.ts`,
  cache: true,
  cacheLocation: `${repoRoot}scripts/.eslintcache-buildkite`,
});

const results = await eslint.lintFiles([".buildkite/scripts"]);
const formatter = await eslint.loadFormatter("stylish");
const output = await formatter.format(results);
if (output.length > 0) {
  console.log(output);
}

const errorCount = results.reduce((sum, result) => sum + result.errorCount, 0);
if (errorCount > 0) {
  process.exitCode = 1;
}
