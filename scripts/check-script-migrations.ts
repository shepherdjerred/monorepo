import { ESLint } from "eslint";
import path from "node:path";
import { Project } from "ts-morph";
import { z } from "zod";

import { run } from "./lib/run.ts";

const OwnerSchema = z
  .object({
    packageJson: z.string().min(1),
    tsconfig: z.string().min(1),
    eslintConfig: z.string().min(1),
  })
  .strict();

const ScriptMigrationSchema = z
  .object({
    source: z.string().endsWith(".sh"),
    disposition: z.enum(["port", "remove-wrapper", "delete", "retain"]),
    reason: z.string().min(1),
    replacement: z.string().endsWith(".ts").optional(),
    owner: OwnerSchema.optional(),
    tests: z.array(z.string().endsWith(".test.ts")).min(1).optional(),
  })
  .strict();

const ManifestSchema = z
  .object({
    $schema: z.string().optional(),
    version: z.literal(1),
    scripts: z.array(ScriptMigrationSchema),
  })
  .strict();

const PackageSchema = z.looseObject({
  scripts: z.record(z.string(), z.string()),
});

type ScriptMigration = z.infer<typeof ScriptMigrationSchema>;
const REPOSITORY_ROOT = path.resolve(import.meta.dir, "..");

export function validateManifestStructure(
  entries: ScriptMigration[],
): string[] {
  const errors: string[] = [];
  const seenSources = new Set<string>();
  for (const entry of entries) {
    if (seenSources.has(entry.source)) {
      errors.push(`duplicate manifest source: ${entry.source}`);
    }
    seenSources.add(entry.source);
    if (entry.disposition === "port") {
      if (entry.replacement === undefined) {
        errors.push(`port is missing replacement: ${entry.source}`);
      }
      if (entry.owner === undefined) {
        errors.push(`port is missing owner: ${entry.source}`);
      }
      if (entry.tests === undefined) {
        errors.push(`port is missing tests: ${entry.source}`);
      }
    } else if (
      entry.replacement !== undefined ||
      entry.owner !== undefined ||
      entry.tests !== undefined
    ) {
      errors.push(
        `non-port entry has replacement quality metadata: ${entry.source}`,
      );
    }
  }
  return errors;
}

async function existingTrackedShellScripts(): Promise<string[]> {
  const result = await run(
    ["git", "ls-files", "-z", "*.sh", ":(exclude)sandbox/**"],
    { capture: true, secret: true, cwd: REPOSITORY_ROOT },
  );
  const paths = result.stdout.split("\0").filter((filePath) => filePath !== "");
  const checks = await Promise.all(
    paths.map(async (filePath) => ({
      exists: await Bun.file(path.resolve(REPOSITORY_ROOT, filePath)).exists(),
      path: filePath,
    })),
  );
  return checks
    .filter(({ exists }) => exists)
    .map(({ path: filePath }) => filePath);
}

async function validateCompletedPort(
  entry: ScriptMigration,
): Promise<string[]> {
  if (
    entry.replacement === undefined ||
    entry.owner === undefined ||
    entry.tests === undefined
  ) {
    return [`port quality metadata is incomplete: ${entry.source}`];
  }
  const errors: string[] = [];
  if (
    !(await Bun.file(path.resolve(REPOSITORY_ROOT, entry.replacement)).exists())
  ) {
    return [
      `shell source was removed before its replacement existed: ${entry.source}`,
    ];
  }
  for (const testPath of entry.tests) {
    if (!(await Bun.file(path.resolve(REPOSITORY_ROOT, testPath)).exists())) {
      errors.push(`missing migration test ${testPath} for ${entry.source}`);
    }
  }

  const packageData = PackageSchema.parse(
    await Bun.file(
      path.resolve(REPOSITORY_ROOT, entry.owner.packageJson),
    ).json(),
  );
  for (const task of ["typecheck", "lint", "test"]) {
    if (packageData.scripts[task] === undefined) {
      errors.push(
        `${entry.owner.packageJson} does not define the standard ${task} task`,
      );
    }
  }

  const project = new Project({
    tsConfigFilePath: path.resolve(REPOSITORY_ROOT, entry.owner.tsconfig),
    skipAddingFilesFromTsConfig: false,
  });
  if (
    project.getSourceFile(path.resolve(REPOSITORY_ROOT, entry.replacement)) ===
    undefined
  ) {
    errors.push(
      `${entry.replacement} is not included by ${entry.owner.tsconfig}`,
    );
  }

  const eslint = new ESLint({
    cwd: REPOSITORY_ROOT,
    overrideConfigFile: path.resolve(REPOSITORY_ROOT, entry.owner.eslintConfig),
  });
  if (
    (await eslint.calculateConfigForFile(
      path.resolve(REPOSITORY_ROOT, entry.replacement),
    )) === undefined
  ) {
    errors.push(
      `${entry.replacement} is ignored by ${entry.owner.eslintConfig}`,
    );
  }
  return errors;
}

export async function checkScriptMigrations(): Promise<void> {
  const manifest = ManifestSchema.parse(
    await Bun.file(`${import.meta.dir}/script-migrations.json`).json(),
  );
  const errors = validateManifestStructure(manifest.scripts);
  const manifestSources = new Set(manifest.scripts.map(({ source }) => source));
  for (const source of await existingTrackedShellScripts()) {
    if (!manifestSources.has(source)) {
      errors.push(`tracked shell script is missing from manifest: ${source}`);
    }
  }

  for (const entry of manifest.scripts) {
    const sourceExists = await Bun.file(
      path.resolve(REPOSITORY_ROOT, entry.source),
    ).exists();
    if (entry.disposition === "retain" && !sourceExists) {
      errors.push(`retained shell script is missing: ${entry.source}`);
    }
    if (entry.disposition === "port" && !sourceExists) {
      errors.push(...(await validateCompletedPort(entry)));
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Shell-to-Bun migration guard failed:\n${errors
        .map((error) => `- ${error}`)
        .join("\n")}`,
    );
  }
  console.log(
    `script migrations: ${manifest.scripts.length.toString()} classified, all active ports owned`,
  );
}

if (import.meta.main) {
  await checkScriptMigrations();
}
