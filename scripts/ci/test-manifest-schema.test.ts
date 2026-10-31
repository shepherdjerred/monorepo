import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  loadTestManifest,
  WorkspaceTestsSchema,
  workspaceDirectories,
} from "./test-manifest-schema.ts";

const root = {
  $schema: "./ci-test-manifest.schema.json",
  version: 2,
  testlessWorkspaces: [
    { package: "@example/docs", directory: "packages/docs", reason: "Docs." },
  ],
  separateTests: [],
};

async function fixture(
  workspaces: unknown,
  files: Record<string, unknown>,
): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "test-manifest-"));
  await mkdir(path.join(directory, "scripts"), { recursive: true });
  await Bun.write(
    path.join(directory, "package.json"),
    JSON.stringify({ workspaces }),
  );
  await Bun.write(
    path.join(directory, "scripts", "ci-test-manifest.json"),
    JSON.stringify(root),
  );
  for (const [file, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await Bun.write(path.join(directory, file), JSON.stringify(contents));
  }
  return directory;
}

const appTests = {
  $schema: "../../scripts/ci-tests.schema.json",
  package: "@example/app",
  steps: [{ runner: "vitest" }],
};

describe("loadTestManifest", () => {
  test("assembles each workspace's ci-tests.json in root package order", async () => {
    const directory = await fixture(
      { packages: ["packages/app", "packages/docs", "scripts"] },
      {
        "packages/app/ci-tests.json": appTests,
        "scripts/ci-tests.json": {
          $schema: "ci-tests.schema.json",
          package: "@example/scripts",
          steps: [{ runner: "vitest" }],
        },
      },
    );
    try {
      const manifest = await loadTestManifest(directory);
      expect(manifest.workspaces).toEqual([
        {
          package: "@example/app",
          directory: "packages/app",
          steps: [{ runner: "vitest" }],
        },
        {
          package: "@example/scripts",
          directory: "scripts",
          steps: [{ runner: "vitest" }],
        },
      ]);
      expect(manifest.testlessWorkspaces).toEqual(root.testlessWorkspaces);
      expect(await workspaceDirectories(directory)).toEqual([
        "packages/app",
        "packages/docs",
        "scripts",
      ]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("rejects a workspace file with an unknown field", async () => {
    const directory = await fixture(["packages/app"], {
      "packages/app/ci-tests.json": { ...appTests, typo: true },
    });
    try {
      await expect(loadTestManifest(directory)).rejects.toThrow();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

describe("WorkspaceTestsSchema", () => {
  test("requires every step to name a group once one does", () => {
    expect(
      WorkspaceTestsSchema.safeParse({
        ...appTests,
        steps: [{ runner: "vitest", group: "jvm" }, { runner: "vitest" }],
      }).success,
    ).toBe(false);
    expect(
      WorkspaceTestsSchema.safeParse({
        ...appTests,
        steps: [
          { runner: "vitest", group: "jvm" },
          { runner: "vitest", group: "tools" },
        ],
      }).success,
    ).toBe(true);
  });

  test("names the shared schema", () => {
    expect(
      WorkspaceTestsSchema.safeParse({ ...appTests, $schema: "other.json" })
        .success,
    ).toBe(false);
  });
});
