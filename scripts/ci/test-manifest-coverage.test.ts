import { describe, expect, test } from "vitest";

import type { TestManifest } from "./ci-reporting.ts";
import {
  isAccountedFor,
  unrunTestFiles,
  vitestSelection,
  workspaceTestFiles,
} from "./test-manifest-coverage.ts";

type Workspace = TestManifest["workspaces"][number];

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    package: "@example/pkg",
    directory: "packages/pkg",
    steps: [{ runner: "vitest", args: ["src"] }],
    ...overrides,
  };
}

function manifest(workspaces: Workspace[]): TestManifest {
  return {
    $schema: "./ci-test-manifest.schema.json",
    version: 2,
    workspaces,
    testlessWorkspaces: [],
    separateTests: [],
  };
}

describe("vitestSelection", () => {
  test("separates filters from option values", () => {
    expect(
      vitestSelection({
        runner: "vitest",
        args: [
          "src",
          "--testTimeout",
          "20000",
          "--exclude",
          "src/slow.test.ts",
        ],
      }),
    ).toEqual({ filters: ["src"], excludes: ["src/slow.test.ts"] });
  });

  test("ignores flags and inline option values", () => {
    expect(
      vitestSelection({
        runner: "vitest",
        args: ["--no-file-parallelism", "--testTimeout=5000"],
      }),
    ).toEqual({ filters: [], excludes: [] });
  });
});

describe("isAccountedFor", () => {
  test("a step without filters runs every file", () => {
    const entry = workspace({ steps: [{ runner: "vitest" }] });
    expect(isAccountedFor(entry, "anything/x.test.ts")).toBe(true);
  });

  test("a filter selects files whose path contains it", () => {
    expect(isAccountedFor(workspace(), "src/a.test.ts")).toBe(true);
    expect(isAccountedFor(workspace(), "scripts/a.test.ts")).toBe(false);
  });

  test("an explicit --exclude accounts for the file", () => {
    const entry = workspace({
      steps: [{ runner: "vitest", args: ["--exclude", "src/wasm.test.ts"] }],
    });
    expect(isAccountedFor(entry, "src/wasm.test.ts")).toBe(true);
  });

  test("an excluded suite covers a directory", () => {
    const entry = workspace({
      excludedSuites: [{ path: "e2e", reason: "Playwright lane" }],
    });
    expect(isAccountedFor(entry, "e2e/home.spec.ts")).toBe(true);
    expect(isAccountedFor(entry, "e2e-helpers/a.test.ts")).toBe(false);
  });

  test("command steps never count as running a Vitest file", () => {
    const entry = workspace({
      steps: [{ runner: "command", name: "x", command: ["bun", "run", "x"] }],
    });
    expect(isAccountedFor(entry, "src/a.test.ts")).toBe(false);
  });
});

describe("workspaceTestFiles", () => {
  test("leaves nested workspaces' files to them", () => {
    expect(
      workspaceTestFiles(
        workspace({ directory: "packages/app" }),
        [
          "packages/app/scripts/a.test.ts",
          "packages/app/packages/backend/b.test.ts",
          "packages/app/src/index.ts",
        ],
        ["packages/app", "packages/app/packages/backend"],
      ),
    ).toEqual(["scripts/a.test.ts"]);
  });

  test("gives the root scripts workspace the .buildkite tests", () => {
    expect(
      workspaceTestFiles(
        workspace({ directory: "scripts" }),
        ["scripts/a.test.ts", ".buildkite/scripts/b.test.ts"],
        ["scripts"],
      ),
    ).toEqual(["a.test.ts", "../.buildkite/scripts/b.test.ts"]);
  });
});

describe("unrunTestFiles", () => {
  test("names each test file no step runs", () => {
    expect(
      unrunTestFiles(
        manifest([workspace()]),
        ["packages/pkg/src/a.test.ts", "packages/pkg/test/b.test.ts"],
        ["packages/pkg"],
      ),
    ).toEqual([
      "scripts/ci-test-manifest.json (@example/pkg): no step runs test/b.test.ts; add it to a step or to excludedSuites with the reason it runs elsewhere",
    ]);
  });
});
