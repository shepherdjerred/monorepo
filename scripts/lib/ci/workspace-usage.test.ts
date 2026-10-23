import { link, mkdir, mkdtemp, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { retainDiagnostics } from "../../ci/run-with-diagnostics.ts";
import { TaskDiagnosticsSchema } from "./task-diagnostics.ts";
import {
  collectWorkspaceUsage,
  WORKSPACE_USAGE_CATEGORIES,
  type WorkspaceUsage,
} from "./workspace-usage.ts";

const MIB = 1024 * 1024;
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map(async (root) => rm(root, { recursive: true, force: true })),
  );
});

async function workspace(files: Record<string, number>) {
  const root = await mkdtemp(path.join(tmpdir(), "workspace-usage-"));
  roots.push(root);
  for (const [name, size] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await Bun.write(path.join(root, name), randomBytes(size));
  }
  return root;
}

function bytes(usage: WorkspaceUsage, name: string) {
  return usage.categories.find((category) => category.name === name)?.bytes;
}

test("attributes a finished workspace's bytes to fixed top-level categories", async () => {
  const root = await workspace({
    ".git/objects/pack/a.pack": 2 * MIB,
    "node_modules/.bun/pkg/index.js": 3 * MIB,
    "packages/web/node_modules/.bin/tool": MIB,
    "packages/web/dist/app.js": MIB,
    "packages/scout/packages/backend/.turbo/turbo-build.log": MIB,
    "packages/web/src/index.ts": MIB,
  });
  // A hard link to an already-counted file adds no bytes.
  await link(
    path.join(root, "node_modules/.bun/pkg/index.js"),
    path.join(root, "node_modules/linked.js"),
  );
  const usage = await collectWorkspaceUsage(root);
  expect(usage.categories.map(({ name }) => name)).toEqual(
    WORKSPACE_USAGE_CATEGORIES.map(({ name }) => name),
  );
  const near = (value: number | null | undefined, expected: number) => {
    expect(value).toBeGreaterThanOrEqual(expected);
    expect(value).toBeLessThan(expected + MIB / 2);
  };
  near(bytes(usage, "git"), 2 * MIB);
  near(bytes(usage, "root-node-modules"), 3 * MIB);
  near(bytes(usage, "package-node-modules"), MIB);
  near(bytes(usage, "package-outputs"), 2 * MIB);
  near(bytes(usage, "workspace"), 9 * MIB);
  expect(bytes(usage, "root-turbo")).toBe(0);
  expect(usage.filesystemUsedBytes).toBeGreaterThan(0);
});

test("a category that misses the shared deadline reports no bytes instead of a partial total", async () => {
  const root = await workspace({ ".git/HEAD": 10 });
  const started = Date.now();
  const usage = await collectWorkspaceUsage(root, {
    deadlineMs: 200,
    du: ["sleep", "30"],
  });
  expect(Date.now() - started).toBeLessThan(10_000);
  expect(bytes(usage, "git")).toBeNull();
  expect(bytes(usage, "workspace")).toBeNull();
  expect(bytes(usage, "root-turbo")).toBe(0);
});

test("workspace usage is retained when measured and never changes the step result", async () => {
  const root = await workspace({});
  const identity = {
    version: 1 as const,
    pipeline: "123",
    commit: "a".repeat(40),
    workflow: "verify" as const,
    startedAt: 100,
    finishedAt: 200,
    exitCode: 0,
  };
  const usage = await collectWorkspaceUsage(root);
  for (const measured of [usage, undefined]) {
    let published: unknown;
    const result = await retainDiagnostics(
      measured === undefined
        ? identity
        : { ...identity, workspaceUsage: measured },
      new Set(),
      root,
      async (report) => {
        published = report;
      },
    );
    expect(result).toBe(0);
    const report = TaskDiagnosticsSchema.parse(published);
    expect(report.workspaceUsage).toEqual(measured);
  }
});
