/**
 * TypeScript type-check entry point for Bazel sandboxed execution.
 *
 * Runs `tsc --noEmit` via child_process to check types without producing
 * output files. Uses the tsconfig.json in the current working directory.
 */
const { execFileSync } = require("child_process");

try {
  execFileSync("tsc", ["--noEmit"], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
} catch (err) {
  // execFileSync throws on non-zero exit
  process.exitCode = err.status || 1;
}
