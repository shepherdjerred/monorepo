import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  WorkspaceTestConfigSchema,
  loadTestManifest,
  readWorkspaceTestConfig,
  workspaceTestConfigSchemaReference,
  workspacesNestedUnder,
} from "./test-manifest-schema.ts";

let root: string;

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await Bun.write(path.join(root, file), JSON.stringify(value));
}

async function writeRepository(options: {
  testless?: string[];
}): Promise<void> {
  await writeJson("package.json", {
    workspaces: ["packages/app", "packages/app/packages/web", "packages/docs"],
  });
  await writeJson("packages/app/package.json", { name: "@example/app" });
  await writeJson("packages/app/packages/web/package.json", {
    name: "@example/web",
  });
  await writeJson("packages/docs/package.json", { name: "@example/docs" });
  await writeJson("packages/app/ci-test.json", {
    $schema: "../../scripts/ci-test.schema.json",
    steps: [{ runner: "vitest", args: ["src"] }],
  });
  await writeJson("packages/app/packages/web/ci-test.json", {
    $schema: "../../../../scripts/ci-test.schema.json",
    defaultEnv: { MODE: "test" },
    steps: [{ runner: "vitest" }],
  });
  await writeJson("scripts/ci-test-manifest.json", {
    $schema: "./ci-test-manifest.schema.json",
    version: 3,
    testlessWorkspaces: (options.testless ?? ["packages/docs"]).map(
      (directory) => ({
        package: directory,
        directory,
        reason: "No tests exist.",
      }),
    ),
    separateTests: [],
  });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "ci-test-manifest-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("workspace CI test configuration", () => {
  test("references the shared schema relative to the workspace", () => {
    expect(workspaceTestConfigSchemaReference("scripts")).toBe(
      "./ci-test.schema.json",
    );
    expect(workspaceTestConfigSchemaReference("packages/app")).toBe(
      "../../scripts/ci-test.schema.json",
    );
  });

  test("lists nested workspaces relative to their parent", () => {
    expect(
      workspacesNestedUnder("packages/app", [
        "packages/app",
        "packages/app/packages/web",
        "packages/application",
        "packages/docs",
      ]),
    ).toEqual(["packages/web"]);
  });

  test("takes the package identity from the workspace", async () => {
    await writeRepository({});
    expect(
      await readWorkspaceTestConfig(root, "packages/app/packages/web"),
    ).toEqual({
      package: "@example/web",
      directory: "packages/app/packages/web",
      defaultEnv: { MODE: "test" },
      steps: [{ runner: "vitest" }],
    });
    expect(await readWorkspaceTestConfig(root, "packages/docs")).toBe(
      undefined,
    );
  });

  test("rejects a schema reference editors cannot resolve", async () => {
    await writeRepository({});
    await writeJson("packages/app/ci-test.json", {
      $schema: "./ci-test.schema.json",
      steps: [{ runner: "vitest" }],
    });
    await expect(readWorkspaceTestConfig(root, "packages/app")).rejects.toThrow(
      'packages/app/ci-test.json must set "$schema" to "../../scripts/ci-test.schema.json"',
    );
  });

  test("names the invalid file", async () => {
    await writeRepository({});
    await writeJson("packages/app/ci-test.json", {
      $schema: "../../scripts/ci-test.schema.json",
      steps: [],
    });
    await expect(readWorkspaceTestConfig(root, "packages/app")).rejects.toThrow(
      "packages/app/ci-test.json is invalid",
    );
  });

  test("assembles every workspace in declaration order", async () => {
    await writeRepository({});
    const manifest = await loadTestManifest(root);
    expect(manifest.workspaces.map((entry) => entry.package)).toEqual([
      "@example/app",
      "@example/web",
    ]);
    expect(manifest.testlessWorkspaces.map((entry) => entry.directory)).toEqual(
      ["packages/docs"],
    );
  });

  test("groups either every step or none", () => {
    const config = (groups: (string | undefined)[]) =>
      WorkspaceTestConfigSchema.safeParse({
        $schema: "../../scripts/ci-test.schema.json",
        steps: groups.map((group) =>
          group === undefined
            ? { runner: "vitest" }
            : { runner: "vitest", group },
        ),
      }).success;
    expect(config([undefined, undefined])).toBe(true);
    expect(config(["jvm", "tools"])).toBe(true);
    expect(config(["jvm", undefined])).toBe(false);
    expect(config(["JVM"])).toBe(false);
  });

  test("rejects a workspace that is both reporting and testless", async () => {
    await writeRepository({ testless: ["packages/app", "packages/docs"] });
    await expect(loadTestManifest(root)).rejects.toThrow(
      "packages/app/ci-test.json exists, but scripts/ci-test-manifest.json also lists packages/app",
    );
  });
});
