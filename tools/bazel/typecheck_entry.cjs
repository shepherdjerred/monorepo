/**
 * TypeScript type-check entry point for Bazel sandboxed execution.
 *
 * NOTE: This script is no longer used by the typecheck_test macro (which now
 * uses ts_project directly). It's kept for any remaining consumers during
 * the migration transition.
 */
const { execFileSync } = require("child_process");

try {
  execFileSync(process.execPath, ["x", "tsc", "--noEmit"], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
} catch (err) {
  process.exitCode = err.status || 1;
}
