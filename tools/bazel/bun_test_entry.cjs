/**
 * Bun test entry point for Bazel sandboxed execution.
 *
 * js_test runs via the toolchain's "node" binary (which IS Bun via symlink).
 * The node wrapper (process.execPath) adds --require for fs patches, so we
 * cannot use it to invoke `bun test` (it would treat "test" as a module path).
 * Instead, we use JS_BINARY__NODE_BINARY which points to the raw Bun binary.
 * Test files are discovered from the working directory.
 */
const { execFileSync } = require("child_process");
const { readdirSync, statSync } = require("fs");
const { join } = require("path");

function findTestFiles(dir) {
  const results = [];
  try {
    for (const entry of readdirSync(dir).sort()) {
      if (entry === "node_modules") continue;
      const full = join(dir, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) {
          results.push(...findTestFiles(full));
        } else if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(entry)) {
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

const testFiles = findTestFiles(process.cwd());
if (testFiles.length === 0) {
  console.log("No test files found, skipping.");
  process.exit(0);
}

// Use the raw Bun binary (not the node wrapper which adds --require flags)
const bunBinary = process.env.JS_BINARY__NODE_BINARY || process.execPath;

try {
  execFileSync(bunBinary, ["test", "--bail", ...testFiles], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
} catch (err) {
  process.exitCode = err.status || 1;
}
