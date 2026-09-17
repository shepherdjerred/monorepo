import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import { z } from "zod";

const homelabRoot = path.resolve(import.meta.dir, "..");
const tsconfigPath = path.join(homelabRoot, "tsconfig.scripts.json");
const generatedK8sSpecifier =
  "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
const priorityClassesPath = path.join(
  homelabRoot,
  "src/cdk8s/src/misc/priority-classes.ts",
);
const generatedK8sPath = path.join(
  homelabRoot,
  "src/cdk8s/generated/imports/k8s.ts",
);

const PackageScriptsSchema = z.object({
  scripts: z.object({
    typecheck: z.string(),
    build: z.string(),
  }),
});

function resolveGeneratedK8sImport(): string {
  const configFile = ts.readConfigFile(tsconfigPath, (fileName) =>
    ts.sys.readFile(fileName),
  );
  if (configFile.error !== undefined) {
    throw new Error(
      ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"),
    );
  }
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    homelabRoot,
    undefined,
    tsconfigPath,
  );
  const host = ts.createCompilerHost(parsed.options);
  const resolved = ts.resolveModuleName(
    generatedK8sSpecifier,
    priorityClassesPath,
    parsed.options,
    host,
  );
  const fileName = resolved.resolvedModule?.resolvedFileName;
  if (fileName === undefined) {
    throw new Error(
      `tsconfig.scripts.json did not resolve ${generatedK8sSpecifier} from ${priorityClassesPath}`,
    );
  }
  return fileName;
}

async function runHomelabScript(
  script: "typecheck" | "build",
): Promise<string> {
  const proc = Bun.spawn(["bun", "--no-install", "run", script], {
    cwd: homelabRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const output = `${stdout}${stderr}`;
  if (exitCode !== 0) {
    throw new Error(`${script} exited ${String(exitCode)}\n${output}`);
  }
  return output;
}

describe("homelab scripts typecheck", () => {
  test("resolves the generated k8s import used by priority-classes", async () => {
    const resolved = resolveGeneratedK8sImport();
    expect(path.resolve(resolved)).toBe(path.resolve(generatedK8sPath));
    const source = await readFile(resolved, "utf8");
    expect(source).toContain("export class KubePriorityClass");
  });

  test("typecheck and build succeed using the scripts tsconfig", async () => {
    const pkg = PackageScriptsSchema.parse(
      await Bun.file(path.join(homelabRoot, "package.json")).json(),
    );
    expect(pkg.scripts.typecheck).toContain("tsconfig.scripts.json");
    expect(pkg.scripts.build).toContain("tsconfig.scripts.json");

    const typecheckOutput = await runHomelabScript("typecheck");
    const buildOutput = await runHomelabScript("build");
    expect(typecheckOutput).not.toContain(
      "Cannot find module '@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts'",
    );
    expect(buildOutput).not.toContain(
      "Cannot find module '@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts'",
    );
  }, 30_000);
});
