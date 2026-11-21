import path from "node:path";
import { fileURLToPath } from "node:url";
import { Glob } from "bun";
import { expect, test } from "vitest";
import { z } from "zod";

import { checkKnip, generateCommands, knipCommand } from "./knip.ts";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

const PackageJsonSchema = z.object({
  name: z.string(),
  scripts: z.record(z.string(), z.string()).optional(),
});

async function readRequiredText(file: string): Promise<string> {
  const handle = Bun.file(file);
  if (!(await handle.exists())) throw new Error(`missing file: ${file}`);
  return handle.text();
}

async function commandRunsPrisma(
  packageRoot: string,
  scripts: Record<string, string>,
  command: string,
  depth: number,
): Promise<boolean> {
  if (depth > 4) return false;
  if (/\bprisma\b/u.test(command)) return true;
  const invoked =
    /(?:^|[;&|]\s*)(?:bun(?:\s+--\S+)*\s+run|npm\s+run)\s+([\w:-]+)/u.exec(
      command,
    )?.[1];
  const invokedScript = invoked === undefined ? undefined : scripts[invoked];
  if (
    invokedScript !== undefined &&
    (await commandRunsPrisma(packageRoot, scripts, invokedScript, depth + 1))
  ) {
    return true;
  }
  for (const match of command.matchAll(
    /(?:^|\s)(\S+\.(?:ts|js|mjs|cjs))(?=\s|$)/gu,
  )) {
    const relative = match[1];
    if (relative === undefined || relative.startsWith("-")) continue;
    const file = Bun.file(path.join(packageRoot, relative));
    if (!(await file.exists())) continue;
    const source = await file.text();
    if (/\bprisma\b/u.test(source) && /\bgenerate\b/u.test(source)) return true;
  }
  return false;
}

// Knip resolves `#generated/prisma/...` for every workspace client. The root
// gate has to name those producers; a nested `turbo run generate` races them.
async function prismaClientGenerateTasks(repoRoot: string): Promise<string[]> {
  const tasks: string[] = [];
  for (const relative of new Glob("packages/**/prisma/schema.prisma").scanSync({
    cwd: repoRoot,
  })) {
    if (relative.split("/").includes("sandbox")) continue;
    const schemaPath = path.join(repoRoot, relative);
    const schema = await readRequiredText(schemaPath);
    if (!/output\s*=\s*["'][^"']*generated\/prisma/u.test(schema)) continue;
    const packageRoot = path.dirname(path.dirname(schemaPath));
    const pkg = PackageJsonSchema.parse(
      JSON.parse(
        await readRequiredText(path.join(packageRoot, "package.json")),
      ) as unknown,
    );
    const generate = pkg.scripts?.["generate"];
    if (generate === undefined) continue;
    if (
      !(await commandRunsPrisma(packageRoot, pkg.scripts ?? {}, generate, 0))
    ) {
      continue;
    }
    tasks.push(`${pkg.name}#generate`);
  }
  tasks.sort();
  return tasks;
}

test("knip gate enforces configuration hints via knip's structured flag", () => {
  expect(knipCommand).toContain("--treat-config-hints-as-errors");
  expect(knipCommand).not.toContain("--no-config-hints");
  // The gate must run the workspace-installed knip, never a network fetch.
  expect(knipCommand.slice(0, 3)).toEqual(["bunx", "--no-install", "knip"]);
});

test("knip gate materializes temporal's ha-schema so resolution is deterministic", () => {
  // Without this the gate is bistable: `#generated/ha-schema.ts` is
  // unresolved on a cold tree and a stale ignoreUnresolved entry on a
  // warm one. It must NOT nest `turbo run generate`: //#knip runs inside
  // the verify graph, which already runs generate, and nesting races the
  // per-package Prisma generate lock.
  expect(generateCommands).toEqual([
    ["bun", "packages/temporal/scripts/homelab/ensure-ha-schema.ts"],
  ]);
  expect(generateCommands.flat()).not.toContain("turbo");
});

test("checkKnip propagates knip's non-zero exit as a thrown error", async () => {
  // `--config <missing file>` makes knip itself fail fast without a scan, so
  // this asserts the wrapper's fail-fast contract (run() throws on non-zero)
  // without paying for a full repo analysis in unit tests.
  await expect(
    checkKnip(["--config", "knip.does-not-exist.json"]),
  ).rejects.toThrow(/Command failed/);
});

test("cold-checkout Knip orders provider generation even when only the root gate is selected", async () => {
  const child = Bun.spawn(
    [
      "bunx",
      "--no-install",
      "turbo",
      "run",
      "knip",
      "--filter=//",
      "--dry=json",
    ],
    {
      cwd: repositoryRoot,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect({ exitCode, stderr: exitCode === 0 ? "" : stderr }).toEqual({
    exitCode: 0,
    stderr: "",
  });
  const plan = z
    .object({
      tasks: z.array(
        z.object({
          taskId: z.string(),
          dependencies: z.array(z.string()),
          dependents: z.array(z.string()),
          outputs: z.array(z.string()).nullable(),
        }),
      ),
    })
    .parse(JSON.parse(stdout));
  const knip = plan.tasks.find((task) => task.taskId === "//#knip");
  const producer = plan.tasks.find(
    (task) => task.taskId === "@homelab/cdktn#generate",
  );
  expect(knip?.dependencies).toContain("@homelab/cdktn#generate");
  expect(producer?.dependents).toContain("//#knip");
  expect(producer?.outputs).toContain("generated/**");
  const producers = await prismaClientGenerateTasks(repositoryRoot);
  expect(producers).toContain("@shepherdjerred/golink#generate");
  for (const taskId of producers) {
    expect(knip?.dependencies, taskId).toContain(taskId);
    const client = plan.tasks.find((task) => task.taskId === taskId);
    expect(client, taskId).toBeDefined();
    expect(client?.dependents, taskId).toContain("//#knip");
    expect(client?.outputs, taskId).toContain("generated/**");
  }
});
