/**
 * Bun test entry point for Bazel sandboxed execution.
 *
 * Runs `bun test` via child_process. Since Bun is the Node.js replacement
 * in the Bazel sandbox, this effectively runs the package's test suite.
 */
const { execFileSync } = require("child_process");

try {
  execFileSync("bun", ["test"], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
} catch (err) {
  // execFileSync throws on non-zero exit
  process.exitCode = err.status || 1;
}
