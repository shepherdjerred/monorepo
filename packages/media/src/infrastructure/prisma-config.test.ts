import { expect, test } from "vitest";
import { z } from "zod";

const PackageRootUrl = new URL("../..", import.meta.url);

async function runPrismaMigrateDiff(fromSchemaPath: string) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (key !== "DATABASE_URL" && value !== undefined) {
      env[key] = value;
    }
  }
  const proc = Bun.spawn(
    [
      process.execPath,
      "--bun",
      "node_modules/prisma/build/index.js",
      "migrate",
      "diff",
      `--from-schema=${fromSchemaPath}`,
      "--to-schema=prisma/schema.prisma",
      "--script",
      "--exit-code",
    ],
    {
      cwd: PackageRootUrl.pathname,
      env,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

test("prisma migrate diff reports schema changes with exit code 2 when DATABASE_URL is unset", async () => {
  const schemaFile = Bun.file(new URL("prisma/schema.prisma", PackageRootUrl));
  const currentSchema = await schemaFile.text();
  const tempDir = Bun.env["TMPDIR"] ?? "/tmp";
  const modifiedSchemaPath = `${tempDir}/media-prisma-diff-${crypto.randomUUID()}.prisma`;
  await Bun.write(
    modifiedSchemaPath,
    `${currentSchema}\nmodel UnconfiguredDatasourceDiffProbe {\n  id String @id\n}\n`,
  );
  try {
    const diff = await runPrismaMigrateDiff(modifiedSchemaPath);
    expect(diff.exitCode).toBe(2);
    expect(diff.stdout).toContain("UnconfiguredDatasourceDiffProbe");

    const clean = await runPrismaMigrateDiff("prisma/schema.prisma");
    expect(clean.exitCode).toBe(0);
  } finally {
    await Bun.file(modifiedSchemaPath).delete();
  }
}, 30_000);

test("eslint configuration disables automatic single-run inference and caches lint runs", async () => {
  const eslintModule: unknown = await import(
    new URL("eslint.config.ts", PackageRootUrl).href
  );
  const ConfigEntrySchema = z.object({
    languageOptions: z
      .object({
        parserOptions: z
          .object({
            disallowAutomaticSingleRunInference: z.boolean().optional(),
          })
          .optional(),
      })
      .optional(),
  });
  const EslintModuleSchema = z.object({
    default: z.array(ConfigEntrySchema),
  });
  const parsedConfig = EslintModuleSchema.parse(eslintModule);
  expect(
    parsedConfig.default.some(
      (entry) =>
        entry.languageOptions?.parserOptions
          ?.disallowAutomaticSingleRunInference === true,
    ),
  ).toBe(true);

  const pkgText = await Bun.file(
    new URL("package.json", PackageRootUrl),
  ).text();
  const PackageJsonSchema = z.object({
    scripts: z.object({ lint: z.string() }),
  });
  const pkg = PackageJsonSchema.parse(JSON.parse(pkgText));
  expect(pkg.scripts.lint).toContain("eslint --cache .");
});
