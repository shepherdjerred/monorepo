/**
 * ESLint entry point for Bazel sandboxed execution.
 *
 * Runs ESLint via child_process since the ESLint module lives in the
 * package's node_modules, not in the entry script's directory.
 * Uses process.execPath (Bun) to run eslint with --max-warnings=0.
 */
const { execFileSync } = require("child_process");
const { readdirSync, statSync } = require("fs");
const { join } = require("path");

function findSourceFiles(dir) {
  const results = [];
  try {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "dist" || entry === "generated") continue;
      const full = join(dir, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) {
          results.push(...findSourceFiles(full));
        } else if (/\.(ts|tsx|js|jsx|mts|cts)$/.test(entry)) {
          results.push(full);
        }
      } catch (_) {
        // skip inaccessible files
      }
    }
  } catch (_) {
    // skip inaccessible dirs
  }
  return results;
}

// Find the package directory — the entry point runs from tools/bazel/
// but the package is wherever eslint.config.ts is, which is in the
// RUNFILES_DIR. The CWD is set to the package directory by js_test.
const cwd = process.cwd();
const srcDir = join(cwd, "src");

const sourceFiles = findSourceFiles(srcDir);
if (sourceFiles.length === 0) {
  console.log("No source files found to lint, skipping.");
  process.exit(0);
}

try {
  execFileSync(
    process.execPath,
    ["x", "eslint", "--no-cache", "--max-warnings=0", ...sourceFiles],
    {
      stdio: "inherit",
      cwd: cwd,
    },
  );
} catch (err) {
  process.exitCode = err.status || 1;
}
