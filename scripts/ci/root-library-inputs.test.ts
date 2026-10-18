import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import ts from "typescript";

const repository = path.join(import.meta.dir, "../..");
const Summary = z.object({
  tasks: z.array(
    z.object({
      taskId: z.string(),
      hash: z.string(),
      cache: z.object({ status: z.string() }).optional(),
    }),
  ),
});

function moduleReferences(file: string, text: string): string[] {
  if (!/\.[cm]?[jt]sx?$/u.test(file)) return [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const references: string[] = [];
  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      references.push(node.moduleSpecifier.text);
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    )
      references.push(node.argument.literal.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      const argument = node.arguments[0];
      if (argument === undefined || !ts.isStringLiteral(argument))
        throw new Error(
          `Exported helper ${file} has a dynamic module reference; declare and verify its inputs`,
        );
      references.push(argument.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return references;
}

test("the library dependency hash covers every export, local import and workspace import", async () => {
  const manifest = z
    .object({
      exports: z.record(
        z.string(),
        z.union([z.string(), z.record(z.string(), z.string())]),
      ),
      dependencies: z.record(z.string(), z.string()),
      devDependencies: z.record(z.string(), z.string()),
    })
    .parse(
      await Bun.file(path.join(repository, "scripts/package.json")).json(),
    );
  const parsed = ts.parseConfigFileTextToJson(
    "turbo.json",
    await Bun.file(path.join(repository, "scripts/turbo.json")).text(),
  );
  expect(parsed.error).toBeUndefined();
  const config = z
    .object({
      tasks: z.object({
        build: z.object({
          inputs: z.array(z.string()),
          dependsOn: z.array(z.string()),
        }),
      }),
    })
    .parse(parsed.config).tasks.build;
  const covers = (file: string) =>
    config.inputs.some((pattern) => new Bun.Glob(pattern).match(file));
  expect(covers("package.json")).toBe(true);
  const pending = Object.values(manifest.exports)
    .flatMap((value) =>
      typeof value === "string" ? [value] : Object.values(value),
    )
    .map((file) => path.posix.normalize(file));
  const visited = new Set<string>();
  const dependencies = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
  };
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (visited.has(file)) continue;
    visited.add(file);
    expect(
      covers(file),
      `Unhashed exported helper or local import: ${file}`,
    ).toBe(true);
    const text = await Bun.file(path.join(repository, "scripts", file)).text();
    for (const specifier of moduleReferences(file, text)) {
      if (specifier.startsWith(".")) {
        pending.push(
          path.posix.normalize(
            path.posix.join(path.posix.dirname(file), specifier),
          ),
        );
        continue;
      }
      const workspace = Object.entries(dependencies).find(
        ([name, range]) =>
          range.startsWith("workspace:") &&
          (specifier === name || specifier.startsWith(`${name}/`)),
      );
      if (workspace !== undefined)
        expect(
          config.dependsOn,
          `Unhashed exported workspace import: ${specifier}`,
        ).toContain(`${workspace[0]}#build`);
    }
  }
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "root-library-inputs-"));
  await Bun.write(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "root-library-fixture",
      private: true,
      packageManager: `bun@${Bun.version}`,
      workspaces: ["scripts", "packages/*"],
    }),
  );
  await Bun.write(
    path.join(root, ".gitignore"),
    ".turbo/\n**/results/\nnode_modules/\n",
  );
  await Bun.write(
    path.join(root, "turbo.json"),
    Bun.file(path.join(repository, "turbo.json")),
  );
  await Bun.write(
    path.join(root, "scripts/turbo.json"),
    Bun.file(path.join(repository, "scripts/turbo.json")),
  );
  await Bun.write(
    path.join(root, "scripts/package.json"),
    JSON.stringify({
      name: "@shepherdjerred/root-scripts",
      scripts: { test: "true" },
      dependencies: {
        "@shepherdjerred/version-catalog": "workspace:*",
        "@shepherdjerred/s3-signed-request": "workspace:*",
        "@shepherdjerred/delivery": "workspace:*",
      },
    }),
  );
  for (const name of ["version-catalog", "s3-signed-request", "delivery"])
    await Bun.write(
      path.join(root, `packages/${name}/package.json`),
      JSON.stringify({
        name: `@shepherdjerred/${name}`,
        scripts: { build: "true" },
      }),
    );
  await Bun.write(
    path.join(root, "packages/consumer/package.json"),
    JSON.stringify({
      name: "consumer",
      scripts: {
        test: 'bun -e \'await Bun.write("results/proof.txt", "executed")\'',
      },
      dependencies: { "@shepherdjerred/root-scripts": "workspace:*" },
    }),
  );
  await Bun.write(
    path.join(root, "packages/consumer/turbo.json"),
    JSON.stringify({
      extends: ["//"],
      tasks: { test: { outputs: ["results/**"] } },
    }),
  );
  for (const file of [
    "scripts/lib/run.ts",
    "scripts/run-temporal-node.ts",
    "scripts/temporal-replay.ts",
    "packages/version-catalog/src/catalog.json",
    "packages/s3-signed-request/src/index.ts",
    "packages/delivery/src/shared/contract.ts",
  ])
    await Bun.write(
      path.join(root, file),
      file.endsWith(".json")
        ? '{"version":1}\n'
        : "export const version = 1;\n",
    );
  for (const args of [
    ["init", "--quiet"],
    ["add", "."],
  ])
    expect(Bun.spawnSync(["git", ...args], { cwd: root }).exitCode).toBe(0);
  return root;
}

function turbo(root: string, mode: "dry" | "run" = "dry") {
  const result = Bun.spawnSync(
    [
      path.join(repository, "node_modules/.bin/turbo"),
      "run",
      "test",
      "--filter=consumer",
      "--filter=@shepherdjerred/root-scripts",
      "--cache=local:rw",
      ...(mode === "dry" ? ["--dry=json"] : ["--summarize"]),
    ],
    { cwd: root, env: { ...Bun.env, TURBO_TELEMETRY_DISABLED: "1" } },
  );
  expect(
    result.exitCode,
    result.stderr.toString() + result.stdout.toString(),
  ).toBe(0);
  return result.stdout.toString();
}
function hashes(root: string) {
  return Object.fromEntries(
    Summary.parse(JSON.parse(turbo(root))).tasks.map((t) => [t.taskId, t.hash]),
  );
}

test.each(["packages/version-catalog/src/catalog.json"])(
  "release metadata %s preserves consumer hashes while root validation still invalidates",
  async (file) => {
    const root = await fixture();
    try {
      const before = hashes(root);
      await Bun.write(path.join(root, file), '{"version":2}\n');
      const after = hashes(root);
      expect(before["consumer#test"]).toBeDefined();
      expect(after["consumer#test"]).toBe(before["consumer#test"]);
      expect(after["@shepherdjerred/root-scripts#test"]).not.toBe(
        before["@shepherdjerred/root-scripts#test"],
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("exported helper, signer and Delivery contract changes still invalidate the consumer", async () => {
  const root = await fixture();
  try {
    let before = hashes(root);
    for (const file of [
      "scripts/lib/run.ts",
      "scripts/run-temporal-node.ts",
      "scripts/temporal-replay.ts",
      "packages/s3-signed-request/src/index.ts",
      "packages/delivery/src/shared/contract.ts",
    ]) {
      await Bun.write(path.join(root, file), "export const version = 2;\n");
      const after = hashes(root);
      expect(after["consumer#test"]).not.toBe(before["consumer#test"]);
      before = after;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("metadata-only changes produce an actual consumer cache hit and restore its output", async () => {
  const root = await fixture();
  try {
    turbo(root, "run");
    const proof = path.join(root, "packages/consumer/results/proof.txt");
    expect(await Bun.file(proof).text()).toBe("executed");
    await rm(proof);
    await Bun.write(
      path.join(root, "packages/version-catalog/src/catalog.json"),
      '{"version":2}\n',
    );
    const result = turbo(root, "run");
    expect(result).toContain("consumer:test: cache hit");
    expect(await Bun.file(proof).text()).toBe("executed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
