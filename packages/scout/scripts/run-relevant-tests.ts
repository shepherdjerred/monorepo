#!/usr/bin/env bun
/**
 * Runs only tests relevant to the changed files using TypeScript dependency analysis
 * Usage: run-relevant-tests.ts <package-dir> <changed-files...>
 */

const args = Bun.argv.slice(2);
if (args.length < 2) {
  console.error("Usage: run-relevant-tests.ts <package-dir> <changed-files...>");
  throw new Error("Missing required arguments");
}

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- CLI args are checked above
const packageDir = args[0]!;
const changedFiles = args.slice(1);

// Find relevant test files using TypeScript compiler API
const scriptDir = import.meta.dir;
const findTestsScript = `${scriptDir}/find-dependent-tests.ts`;

const findResult = Bun.spawnSync(["bun", findTestsScript, packageDir, ...changedFiles], {
  stdout: "pipe",
  stderr: "pipe",
});

if (findResult.exitCode !== 0) {
  const stderr = new TextDecoder().decode(findResult.stderr);
  console.error("Error finding test files:");
  console.error(stderr);
  throw new Error(`find-dependent-tests failed with exit code ${String(findResult.exitCode)}`);
}

// Parse test files from stdout (one per line)
const stdout = new TextDecoder().decode(findResult.stdout);
const testFiles = stdout
  .trim()
  .split("\n")
  .filter((line) => line.length > 0);

// Log stderr (diagnostics) from find-dependent-tests
const stderr = new TextDecoder().decode(findResult.stderr);
if (stderr) {
  console.error(stderr);
}

// Check if we got any test files
if (testFiles.length === 0) {
  console.log("No test files found for changed files, skipping tests.");
  process.exit(0);
}

console.log(`Running ${String(testFiles.length)} relevant test file(s)...`);

// Resolve package directory
const repoRoot = `${scriptDir}/..`;
const absolutePackageDir = `${repoRoot}/${packageDir}`;

// Run the tests
const testResult = Bun.spawnSync(["bun", "test", ...testFiles], {
  cwd: absolutePackageDir,
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});

process.exit(testResult.exitCode);
