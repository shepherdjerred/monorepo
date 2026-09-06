import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  isQualityPath,
  loadWorkspaces,
  packagesForStagedPaths,
  runStagedPackageQuality,
  toRepoRelative,
  turboQualityCommand,
  type WorkspacePackage,
} from "./staged-package-quality.ts";

const fixtures: readonly WorkspacePackage[] = [
  {
    name: "scout-for-lol",
    directory: "packages/scout-for-lol",
    scripts: new Set(["typecheck", "lint", "test"]),
  },
  {
    name: "@scout-for-lol/backend",
    directory: "packages/scout-for-lol/packages/backend",
    scripts: new Set(["typecheck", "lint", "test", "generate"]),
  },
  {
    name: "@shepherdjerred/root-scripts",
    directory: "scripts",
    scripts: new Set(["typecheck", "lint", "test"]),
  },
  {
    name: "@shepherdjerred/docs-wiki",
    directory: "packages/docs/wiki",
    scripts: new Set(["typecheck", "lint"]),
  },
  {
    name: "docs-only",
    directory: "packages/docs-only",
    scripts: new Set(["build"]),
  },
];

describe("isQualityPath", () => {
  test("accepts TypeScript, JavaScript, JSON, and Astro that typecheck or lint read", () => {
    expect(isQualityPath("packages/foo/src/index.ts")).toBe(true);
    expect(isQualityPath("packages/foo/src/index.test.ts")).toBe(true);
    expect(isQualityPath("packages/foo/eslint.config.ts")).toBe(true);
    expect(isQualityPath("packages/foo/package.json")).toBe(true);
    expect(isQualityPath("packages/foo/tsconfig.json")).toBe(true);
    expect(isQualityPath("scripts/lib/run.mjs")).toBe(true);
    expect(
      isQualityPath("packages/docs/wiki/src/content/docs/index.astro"),
    ).toBe(true);
  });

  test("rejects docs, generated output, dependencies, and sandbox", () => {
    expect(isQualityPath("packages/foo/README.md")).toBe(false);
    expect(isQualityPath("packages/foo/src/index.rs")).toBe(false);
    expect(isQualityPath("packages/foo/generated/client.ts")).toBe(false);
    expect(isQualityPath("packages/foo/node_modules/zod/index.ts")).toBe(false);
    expect(isQualityPath("sandbox/experiment.ts")).toBe(false);
  });
});

describe("packagesForStagedPaths", () => {
  test("selects the longest workspace prefix so nested packages win", () => {
    expect(
      packagesForStagedPaths(
        ["packages/scout-for-lol/packages/backend/src/index.ts"],
        fixtures,
      ),
    ).toEqual(["@scout-for-lol/backend"]);
  });

  test("maps scripts and Buildkite TypeScript onto root-scripts", () => {
    expect(
      packagesForStagedPaths(
        [
          "scripts/checks/staged-package-quality.ts",
          ".buildkite/scripts/ci-changed.ts",
        ],
        fixtures,
      ),
    ).toEqual(["@shepherdjerred/root-scripts"]);
  });

  test("maps Buildkite ESLint suppressions and tsconfig onto root-scripts", () => {
    expect(
      packagesForStagedPaths(
        [".buildkite/eslint-suppressions.json", ".buildkite/tsconfig.json"],
        fixtures,
      ),
    ).toEqual(["@shepherdjerred/root-scripts"]);
  });

  test("maps Astro sources onto their owning workspace", () => {
    expect(
      packagesForStagedPaths(
        ["packages/docs/wiki/src/content/docs/index.astro"],
        fixtures,
      ),
    ).toEqual(["@shepherdjerred/docs-wiki"]);
  });

  test("unions unique package names and ignores non-quality paths", () => {
    expect(
      packagesForStagedPaths(
        [
          "packages/scout-for-lol/README.md",
          "packages/scout-for-lol/scripts/dev-web.ts",
          "packages/scout-for-lol/packages/backend/src/index.ts",
        ],
        fixtures,
      ),
    ).toEqual(["@scout-for-lol/backend", "scout-for-lol"]);
  });

  test("skips workspaces that define neither typecheck nor lint", () => {
    expect(
      packagesForStagedPaths(["packages/docs-only/package.json"], fixtures),
    ).toEqual([]);
  });

  test("does not add dependents of a changed package", () => {
    expect(
      packagesForStagedPaths(
        ["packages/scout-for-lol/packages/backend/src/index.ts"],
        fixtures,
      ),
    ).toEqual(["@scout-for-lol/backend"]);
  });
});

describe("turboQualityCommand", () => {
  test("runs only typecheck and lint, package-filtered, concurrency 1", () => {
    expect(
      turboQualityCommand(["@scout-for-lol/backend", "scout-for-lol"]),
    ).toEqual([
      "bunx",
      "--no-install",
      "turbo",
      "run",
      "typecheck",
      "lint",
      "--filter=@scout-for-lol/backend",
      "--filter=scout-for-lol",
      "--concurrency=1",
      "--output-logs=errors-only",
    ]);
  });
});

describe("toRepoRelative", () => {
  test("keeps repository-relative posix paths", () => {
    expect(toRepoRelative("packages/foo/src/a.ts", "/repo")).toBe(
      "packages/foo/src/a.ts",
    );
  });

  test("rejects paths outside the repository", () => {
    expect(() => toRepoRelative("../secret.ts", "/repo")).toThrow(
      "outside the repository",
    );
  });
});

describe("runStagedPackageQuality", () => {
  test("skips turbo when no quality package owns the staged files", async () => {
    const commands: string[][] = [];
    const result = await runStagedPackageQuality(["README.md"], {
      repositoryRoot: "/repo",
      workspaces: fixtures,
      runCommand: async (command) => {
        commands.push([...command]);
      },
    });
    expect(result).toBe("skipped");
    expect(commands).toEqual([]);
  });

  test("invokes turbo for the owning packages", async () => {
    const commands: string[][] = [];
    const result = await runStagedPackageQuality(
      ["packages/scout-for-lol/packages/backend/src/index.ts"],
      {
        repositoryRoot: "/repo",
        workspaces: fixtures,
        runCommand: async (command) => {
          commands.push([...command]);
        },
      },
    );
    expect(result).toBe("ran");
    expect(commands).toEqual([turboQualityCommand(["@scout-for-lol/backend"])]);
  });
});

describe("loadWorkspaces", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  test("reads nested workspace names and scripts from package.json files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "package-quality-"));
    roots.push(root);
    await writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify(
        {
          name: "root",
          workspaces: ["packages/app", "packages/app/nested"],
        },
        undefined,
        2,
      )}\n`,
    );
    await mkdir(path.join(root, "packages/app/nested"), { recursive: true });
    await writeFile(
      path.join(root, "packages/app/package.json"),
      `${JSON.stringify(
        { name: "app", scripts: { typecheck: "tsc", lint: "eslint ." } },
        undefined,
        2,
      )}\n`,
    );
    await writeFile(
      path.join(root, "packages/app/nested/package.json"),
      `${JSON.stringify(
        { name: "app-nested", scripts: { lint: "eslint ." } },
        undefined,
        2,
      )}\n`,
    );

    const workspaces = await loadWorkspaces(root);
    expect(
      workspaces.map((workspace) => ({
        name: workspace.name,
        directory: workspace.directory,
        scripts: [...workspace.scripts].sort(),
      })),
    ).toEqual([
      {
        name: "app",
        directory: "packages/app",
        scripts: ["lint", "typecheck"],
      },
      {
        name: "app-nested",
        directory: "packages/app/nested",
        scripts: ["lint"],
      },
    ]);
  });
});
