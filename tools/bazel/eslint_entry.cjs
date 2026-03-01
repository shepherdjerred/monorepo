/**
 * ESLint entry point for Bazel sandboxed execution.
 *
 * Runs ESLint programmatically using the ESLint API. The eslint.config.ts
 * in the package directory is auto-detected. Files to lint are discovered
 * from the src/ directory.
 */
const { ESLint } = require("eslint");

async function main() {
  const eslint = new ESLint({
    // ESLint auto-detects eslint.config.ts in cwd
  });

  const results = await eslint.lintFiles(["src/**/*.ts", "src/**/*.tsx"]);
  const formatter = await eslint.loadFormatter("stylish");
  const output = await formatter.format(results);

  if (output) {
    console.log(output);
  }

  const errorCount = results.reduce((sum, r) => sum + r.errorCount, 0);
  const warningCount = results.reduce((sum, r) => sum + r.warningCount, 0);

  if (errorCount > 0 || warningCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
