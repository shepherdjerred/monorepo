import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { findComplianceErrors } from "./compliance-check.ts";
import { isNoopScript } from "./migration-core.ts";

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

test("rejects ambiguous TypeScript compiler commands and missing native aliases", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "compliance-check-"));
  try {
    await writeRootManifest(root, ["packages/example"]);
    await writeWorkspacePackage(root, "packages/example", {
      scripts: {
        ...compliantScripts,
        typecheck: "bunx --no-install tsc --noEmit",
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
});

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
