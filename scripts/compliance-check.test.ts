import { Glob } from "bun";
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  findComplianceErrors,
  invokesAmbiguousTypeScriptCompiler,
} from "./compliance-check.ts";
import { isNoopScript } from "./migration-core.ts";

const TurboConfigSchema = z
  .object({
    tasks: z
      .object({
        "//#compliance-check": z.object({ inputs: z.array(z.string()) }),
      })
      .loose(),
  })
  .loose();

function collectTaskInputs(root: string, patterns: string[]): string[] {
  const inputs = new Set<string>();
  for (const pattern of patterns) {
    const isExclusion = pattern.startsWith("!");
    const glob = isExclusion ? pattern.slice(1) : pattern;
    for (const file of new Glob(glob).scanSync({
      cwd: root,
      onlyFiles: true,
    })) {
      if (isExclusion) {
        inputs.delete(file);
      } else {
        inputs.add(file);
      }
    }
  }
  return [...inputs].sort((left, right) => left.localeCompare(right));
}

async function writeRootManifest(
  root: string,
  workspaces: string[],
): Promise<void> {
  await mkdir(`${root}/scripts`, { recursive: true });
  await Bun.write(
    `${root}/package.json`,
    JSON.stringify({ workspaces: [...workspaces, "scripts"] }),
  );
  await Bun.write(`${root}/scripts/package.json`, "{}");
}

async function writeWorkspacePackage(
  root: string,
  directory: string,
  packageJson: unknown,
): Promise<void> {
  await mkdir(`${root}/${directory}`, { recursive: true });
  await Bun.write(
    `${root}/${directory}/package.json`,
    JSON.stringify(packageJson),
  );
}

const compliantScripts = {
  build: "bun build.ts",
  test: "bun test",
  lint: "eslint .",
  typecheck: "PATH=node_modules/@typescript/native/bin:$PATH tsc --noEmit",
};

test("Turbo compliance inputs cover deeply nested workspace manifests", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "compliance-inputs-"));
  try {
    await writeRootManifest(root, [
      "packages/homelab/src/cdk8s",
      "packages/homelab/src/helm-types",
    ]);
    await writeWorkspacePackage(root, "packages/homelab/src/cdk8s", {});
    await writeWorkspacePackage(root, "packages/homelab/src/helm-types", {});
    await writeWorkspacePackage(
      root,
      "packages/homelab/node_modules/dependency",
      {},
    );
    await Bun.write(`${root}/scripts/compliance-check.ts`, "");

    const turboConfig = TurboConfigSchema.parse(
      Bun.JSONC.parse(
        await Bun.file(path.join(import.meta.dir, "..", "turbo.json")).text(),
      ),
    );

    expect(
      collectTaskInputs(root, turboConfig.tasks["//#compliance-check"].inputs),
    ).toEqual([
      "package.json",
      "packages/homelab/src/cdk8s/package.json",
      "packages/homelab/src/helm-types/package.json",
      "scripts/compliance-check.ts",
      "scripts/package.json",
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

describe("invokesAmbiguousTypeScriptCompiler", () => {
  test.each([
    "tsc --noEmit",
    "bunx tsc --noEmit",
    "bunx --no-install tsc --noEmit",
    "bunx --bun --verbose tsc --noEmit",
    "bunx -p typescript tsc --noEmit",
    "bun x tsc --noEmit",
    "bun --bun x --no-install tsc --noEmit",
    "bun --cwd=. x --silent tsc --noEmit",
    "bun --preload=./setup.ts x --no-install tsc --noEmit",
    "bun --conditions=development --smol x tsc --noEmit",
    "bun x --package typescript tsc --noEmit",
    "bun run tsc --noEmit",
    "bun run --silent tsc --noEmit",
    "NODE_OPTIONS=--max-old-space-size=4096 tsc --noEmit",
    "CI=1 NODE_OPTIONS=--max-old-space-size=4096 tsc --noEmit",
    "PATH=node_modules/@typescript/native/bin:$PATH PATH=/usr/bin tsc --noEmit",
    "NODE_OPTIONS=--max-old-space-size=4096 bunx --no-install tsc --noEmit",
    "CI=1 NODE_OPTIONS=--max-old-space-size=4096 bun --bun x --no-install tsc --noEmit",
    "eslint . && bun --silent x --verbose tsc --noEmit",
  ])("recognizes %s", (command) => {
    expect(invokesAmbiguousTypeScriptCompiler(command)).toBe(true);
  });

  test.each([
    "PATH=node_modules/@typescript/native/bin:$PATH tsc --noEmit",
    "CI=1 PATH=node_modules/@typescript/native/bin:$PATH tsc --noEmit",
    "PATH=/usr/bin PATH=node_modules/@typescript/native/bin:$PATH tsc --noEmit",
    'COMPILER="tsc --noEmit" eslint .',
    "bun test tsc",
    "bun x eslint tsc",
    "bunx eslint tsc",
    "bun x --package tsc eslint",
    "bun --cwd . x --no-install tsc --noEmit",
    'echo "bun x tsc --noEmit"',
    "mybun x tsc --noEmit",
  ])("ignores %s", (command) => {
    expect(invokesAmbiguousTypeScriptCompiler(command)).toBe(false);
  });

  test("ignores bun run tsc when a tsc script is declared", () => {
    expect(
      invokesAmbiguousTypeScriptCompiler(
        "bun run tsc --noEmit",
        new Set(["tsc"]),
      ),
    ).toBe(false);
  });

  test("flags bun run tsc when no tsc script is declared", () => {
    expect(
      invokesAmbiguousTypeScriptCompiler(
        "bun run tsc --noEmit",
        new Set(["typecheck"]),
      ),
    ).toBe(true);
  });
});

describe("isNoopScript", () => {
  test.each([
    "true",
    ":",
    "echo",
    "echo not implemented",
    "echo\tnot implemented",
  ])("rejects %s", (command) => {
    expect(isNoopScript(command)).toBe(true);
  });

  test("accepts a real command", () => {
    expect(isNoopScript("bun test")).toBe(false);
  });
});

test("checks only root-declared workspaces", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "compliance-check-"));
  try {
    await writeRootManifest(root, ["packages/example"]);
    await writeWorkspacePackage(root, "packages/example", {
      scripts: compliantScripts,
      devDependencies: {
        "@typescript/native": "npm:typescript@7.0.2",
        typescript: "^6.0.3",
      },
    });
    await writeWorkspacePackage(root, "packages/example/generated", {
      scripts: { typecheck: "tsc --noEmit" },
    });

    expect(await findComplianceErrors(root)).toEqual([]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("checks representative nested workspaces declared by the root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "compliance-check-"));
  const nestedDirectories = [
    "packages/discord-plays-pokemon/packages/backend",
    "packages/homelab/src/cdk8s",
    "packages/scout-for-lol/packages/backend",
  ];
  try {
    await writeRootManifest(root, nestedDirectories);
    for (const directory of nestedDirectories) {
      await writeWorkspacePackage(root, directory, {
        scripts: { ...compliantScripts, typecheck: "tsc --noEmit" },
        devDependencies: {
          typescript: "^6.0.3",
        },
      });
    }

    expect(await findComplianceErrors(root)).toEqual(
      nestedDirectories.flatMap((directory) => [
        `${directory} must declare @typescript/native as npm:typescript@7.0.2`,
        `${directory} script typecheck invokes ambiguous tsc instead of PATH=node_modules/@typescript/native/bin:$PATH tsc`,
      ]),
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("keeps root-excluded workspace paths out of compliance checks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "compliance-check-"));
  try {
    await writeRootManifest(root, [
      "packages/**",
      "!packages/example/generated",
    ]);
    await writeWorkspacePackage(root, "packages/example", {
      scripts: compliantScripts,
      devDependencies: {
        "@typescript/native": "npm:typescript@7.0.2",
      },
    });
    await writeWorkspacePackage(root, "packages/example/generated", {
      scripts: { typecheck: "tsc --noEmit" },
    });

    expect(await findComplianceErrors(root)).toEqual([
      "package.json contains excluded workspaces (!packages/...)",
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("rejects duplicate root workspace patterns", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "compliance-check-"));
  try {
    await writeRootManifest(root, ["packages/example", "packages/example"]);

    await expect(findComplianceErrors(root)).rejects.toThrow(
      "duplicate workspace pattern: packages/example",
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test.each([
  ["unsafe", "../outside", "without parent traversal"],
  ["unmatched", "packages/missing", "matched no packages"],
])("rejects %s root workspace patterns", async (_, pattern, message) => {
  const root = await mkdtemp(path.join(tmpdir(), "compliance-check-"));
  try {
    await writeRootManifest(root, [pattern]);

    await expect(findComplianceErrors(root)).rejects.toThrow(message);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test.each([
  "bunx --no-install tsc --noEmit",
  "bun --bun x --no-install tsc --noEmit",
])(
  "rejects ambiguous compiler command %s and a missing native alias",
  async (typecheck) => {
    const root = await mkdtemp(path.join(tmpdir(), "compliance-check-"));
    try {
      await writeRootManifest(root, ["packages/example"]);
      await writeWorkspacePackage(root, "packages/example", {
        scripts: {
          ...compliantScripts,
          typecheck,
        },
        devDependencies: { typescript: "^6.0.3" },
      });

      const errors = await findComplianceErrors(root);
      expect(errors).toContain(
        "packages/example script typecheck invokes ambiguous tsc instead of PATH=node_modules/@typescript/native/bin:$PATH tsc",
      );
      expect(errors).toContain(
        "packages/example must declare @typescript/native as npm:typescript@7.0.2",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  },
);

test("rejects native compiler aliases that no script invokes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "compliance-check-"));
  try {
    await writeRootManifest(root, ["packages/example"]);
    await writeWorkspacePackage(root, "packages/example", {
      scripts: { ...compliantScripts, typecheck: "astro check" },
      devDependencies: {
        "@typescript/native": "npm:typescript@7.0.2",
        typescript: "^6.0.3",
      },
    });

    expect(await findComplianceErrors(root)).toContain(
      "packages/example declares @typescript/native without invoking the native compiler",
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
