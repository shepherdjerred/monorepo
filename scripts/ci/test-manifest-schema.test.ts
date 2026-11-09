import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  loadTestManifest,
  readWorkspaceTests,
  stepRunsInTier,
  WorkspaceTestsSchema,
  workspaceDirectories,
  workspaceTestsSchemaReference,
  type TestStep,
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
const appPackage = { name: "@example/app" };

describe("loadTestManifest", () => {
  test("assembles each workspace's ci-tests.json in root package order", async () => {
    const directory = await fixture(
      { packages: ["packages/app", "packages/docs", "scripts"] },
      {
        "packages/app/ci-tests.json": appTests,
        "packages/app/package.json": appPackage,
        "scripts/package.json": { name: "@example/scripts" },
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
      "packages/app/package.json": appPackage,
    });
    try {
      await expect(loadTestManifest(directory)).rejects.toThrow();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

describe("readWorkspaceTests", () => {
  test("is undefined for a workspace without CI test steps", async () => {
    const directory = await fixture(["packages/docs"], {
      "packages/docs/package.json": { name: "@example/docs" },
    });
    try {
      expect(await readWorkspaceTests(directory, "packages/docs")).toBe(
        undefined,
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("requires the exact relative schema path", async () => {
    expect(workspaceTestsSchemaReference("scripts")).toBe(
      "ci-tests.schema.json",
    );
    expect(workspaceTestsSchemaReference("packages/a/packages/b")).toBe(
      "../../../../scripts/ci-tests.schema.json",
    );
    const directory = await fixture(["packages/app"], {
      // Names the shared file, but from the wrong directory.
      "packages/app/ci-tests.json": {
        ...appTests,
        $schema: "../scripts/ci-tests.schema.json",
      },
      "packages/app/package.json": appPackage,
    });
    try {
      await expect(loadTestManifest(directory)).rejects.toThrow(
        'packages/app/ci-tests.json must set "$schema" to "../../scripts/ci-tests.schema.json", not "../scripts/ci-tests.schema.json"',
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("requires the workspace's package.json name", async () => {
    const directory = await fixture(["packages/app"], {
      "packages/app/ci-tests.json": { ...appTests, package: "@example/other" },
      "packages/app/package.json": appPackage,
    });
    try {
      await expect(
        readWorkspaceTests(directory, "packages/app"),
      ).rejects.toThrow(
        'packages/app/ci-tests.json names package "@example/other", but packages/app/package.json is "@example/app"',
      );
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

  test("accepts a tier on every runner and shared only on commands", () => {
    for (const step of [
      { runner: "vitest", tier: "extended" },
      { runner: "go", tier: "ci", args: ["./..."] },
      { runner: "cargo", tier: "extended", args: [] },
      { runner: "dotnet", tier: "extended", args: ["Tests.csproj"] },
      { runner: "gradle", tier: "extended", args: ["test"] },
      { runner: "command", name: "stub", tier: "shared", command: ["true"] },
    ]) {
      expect(
        WorkspaceTestsSchema.safeParse({ ...appTests, steps: [step] }).success,
        JSON.stringify(step),
      ).toBe(true);
    }
    expect(
      WorkspaceTestsSchema.safeParse({
        ...appTests,
        steps: [{ runner: "vitest", tier: "shared" }],
      }).success,
    ).toBe(false);
    expect(
      WorkspaceTestsSchema.safeParse({
        ...appTests,
        steps: [{ runner: "vitest", tier: "nightly" }],
      }).success,
    ).toBe(false);
  });
});

describe("stepRunsInTier", () => {
  test("an omitted tier is ci", () => {
    expect(stepRunsInTier({ runner: "vitest" }, "ci")).toBe(true);
    expect(stepRunsInTier({ runner: "vitest" }, "extended")).toBe(false);
  });

  test("an extended step runs only in the extended tier", () => {
    const step = { runner: "vitest", tier: "extended" } as const;
    expect(stepRunsInTier(step, "extended")).toBe(true);
    expect(stepRunsInTier(step, "ci")).toBe(false);
  });

  test("a shared command runs in both tiers", () => {
    const step: TestStep = {
      runner: "command",
      name: "stub",
      tier: "shared",
      command: ["true"],
    };
    expect(stepRunsInTier(step, "ci")).toBe(true);
    expect(stepRunsInTier(step, "extended")).toBe(true);
  });
});
