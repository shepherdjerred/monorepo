import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const committedTemplatePath = `${import.meta.dirname}/../src/testing/template.db`;
const generatorPath = `${import.meta.dirname}/generate-test-template-db.ts`;

function buildChildEnv(templatePath: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  env["SCOUT_TEST_TEMPLATE_DB_PATH"] = templatePath;
  return env;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }

  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function getBunExecutable(): string {
  const executable = Bun.argv[0];
  if (executable === undefined) {
    throw new Error("Unable to locate Bun executable for template generation");
  }
  return executable;
}

const tempDir = mkdtempSync(join(tmpdir(), "scout-test-template-"));
const generatedTemplatePath = join(tempDir, "template.db");

try {
  const result = Bun.spawnSync({
    cmd: [getBunExecutable(), "run", generatorPath],
    cwd: `${import.meta.dirname}/..`,
    env: buildChildEnv(generatedTemplatePath),
    stdout: "inherit",
    stderr: "inherit",
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to generate test template database for freshness check (exit ${result.exitCode.toString()})`,
    );
  }

  const committedBytes = await Bun.file(committedTemplatePath).bytes();
  const generatedBytes = await Bun.file(generatedTemplatePath).bytes();

  if (!bytesEqual(committedBytes, generatedBytes)) {
    console.error(
      [
        "Scout test template database is stale.",
        "",
        "Run this from packages/scout-for-lol/packages/backend:",
        "  bun run generate:test-template",
        "",
        `Committed: ${committedTemplatePath}`,
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log("Scout test template database is up-to-date.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}
