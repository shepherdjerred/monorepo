import { mkdtemp, mkdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
  collectTaskDiagnostics,
  TurboDiagnosticSchema,
} from "./task-diagnostics.ts";
import {
  prepareDiagnostics,
  retainDiagnostics,
} from "../../ci/run-with-diagnostics.ts";

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories
      .splice(0)
      .map(async (directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
  );
});

async function repository(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "ci-diagnostic-test-"));
  directories.push(directory);
  await mkdir(path.join(directory, ".turbo/runs"), { recursive: true });
  return directory;
}

const identity = {
  version: 1 as const,
  pipeline: "123",
  commit: "a".repeat(40),
  workflow: "verify" as const,
  startedAt: 100,
  finishedAt: 500,
  exitCode: 0,
};

function summary() {
  return {
    id: "run-one",
    turboVersion: "2.11.7",
    environmentVariables: { secret: "sentinel-secret" },
    execution: {
      startTime: 200,
      endTime: 400,
      exitCode: 0,
      success: 1,
      failed: 0,
      cached: 1,
      attempted: 1,
      command: "sentinel-command",
    },
    tasks: [
      {
        taskId: "@test/package#test:ci",
        hash: "abcd1234",
        cache: { local: false, remote: true, status: "HIT", timeSaved: 25 },
        execution: { startTime: 210, endTime: 390, exitCode: 0 },
        dependencies: ["@test/package#build"],
        command: "sentinel-task-command",
        environmentVariables: { secret: "sentinel-secret" },
        inputs: { ".env": "sentinel-input" },
        resolvedTaskDefinition: { env: ["sentinel-env"] },
      },
    ],
  };
}

test("retains only allowlisted task, cache and timing evidence", () => {
  const sanitized = TurboDiagnosticSchema.parse(summary());
  expect(sanitized.tasks[0]).toEqual({
    taskId: "@test/package#test:ci",
    hash: "abcd1234",
    cache: { local: false, remote: true, status: "HIT", timeSaved: 25 },
    dependencies: ["@test/package#build"],
    execution: { startTime: 210, endTime: 390, exitCode: 0 },
  });
  expect(JSON.stringify(sanitized)).not.toContain("sentinel");
});

test("collects new summaries, excludes earlier runs, and binds identity", async () => {
  const root = await repository();
  await Bun.write(
    path.join(root, ".turbo/runs/old.json"),
    "invalid old summary",
  );
  await Bun.write(
    path.join(root, ".turbo/runs/new.json"),
    JSON.stringify(summary()),
  );
  const report = await collectTaskDiagnostics(
    identity,
    new Set(["old.json"]),
    root,
  );
  expect(report).toMatchObject({ ...identity, collectionFailed: false });
  expect(report.turbo).toHaveLength(1);
});

test("browser selection strips exception text, paths and arbitrary metadata", async () => {
  const root = await repository();
  await Bun.write(
    path.join(root, "playwright-selection-report.json"),
    JSON.stringify({
      base: null,
      mode: "all",
      globalReason: "sentinel-exception",
      changedPaths: ["sentinel-path"],
      targets: [
        {
          package: "@test/browser",
          cache: "NOT_RUN",
          reasons: ["sentinel-reason"],
        },
      ],
    }),
  );
  const report = await collectTaskDiagnostics(
    { ...identity, workflow: "playwright-e2e", exitCode: 1 },
    new Set(),
    root,
  );
  expect(report.browserSelection).toEqual({
    base: null,
    mode: "all",
    targets: [{ package: "@test/browser", cache: "NOT_RUN" }],
  });
  expect(JSON.stringify(report)).not.toContain("sentinel");
});

test("removes stale browser selection before execution and accepts fresh reports on coarse clocks", async () => {
  const root = await repository();
  const selection = path.join(root, "playwright-selection-report.json");
  await Bun.write(selection, "old report");
  await prepareDiagnostics("playwright-e2e", root);
  expect(await Bun.file(selection).exists()).toBe(false);
  const record = { base: null, mode: "selected", targets: [] };
  await Bun.write(selection, JSON.stringify(record));
  await utimes(selection, new Date(0), new Date(0));
  const report = await collectTaskDiagnostics(
    { ...identity, workflow: "playwright-e2e" },
    new Set(),
    root,
  );
  expect(report.browserSelection).toEqual(record);
});

test.each([0, 42])(
  "publishes even when the task exits %i",
  async (exitCode) => {
    const root = await repository();
    const upload = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    expect(
      await retainDiagnostics(
        { ...identity, exitCode },
        new Set(),
        root,
        upload,
      ),
    ).toBe(exitCode);
    expect(upload).toHaveBeenCalledWith({
      ...identity,
      exitCode,
      collectionFailed: false,
      turbo: [],
    });
  },
);

test.each([0, 42])(
  "publication failure preserves nonzero task exit %i",
  async (exitCode) => {
    const root = await repository();
    const error = vi.spyOn(console, "error").mockImplementation(vi.fn());
    const upload = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error("sentinel-secret"));
    expect(
      await retainDiagnostics(
        { ...identity, exitCode },
        new Set(),
        root,
        upload,
      ),
    ).toBe(exitCode || 1);
    expect(JSON.stringify(error.mock.calls)).not.toContain("sentinel");
  },
);

test("malformed summaries publish explicit failure metadata without parser values", async () => {
  const root = await repository();
  await Bun.write(
    path.join(root, ".turbo/runs/invalid.json"),
    JSON.stringify({ id: "sentinel-secret" }),
  );
  const upload = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const error = vi.spyOn(console, "error").mockImplementation(vi.fn());
  expect(
    await retainDiagnostics(
      { ...identity, exitCode: 42 },
      new Set(),
      root,
      upload,
    ),
  ).toBe(42);
  expect(upload).toHaveBeenCalledWith({
    ...identity,
    exitCode: 42,
    collectionFailed: true,
    turbo: [],
  });
  expect(JSON.stringify(error.mock.calls)).not.toContain("sentinel");
});

test("wrapper forwards command output and preserves its exit without upload credentials", async () => {
  const root = await repository();
  const child = Bun.spawn(
    [
      process.execPath,
      new URL("../../ci/run-with-diagnostics.ts", import.meta.url).pathname,
      "verify",
      "--",
      process.execPath,
      "-e",
      "console.log('child-output'); process.exit(42)",
    ],
    {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      env: { CI_PIPELINE_NUMBER: "123", CI_COMMIT_SHA: "a".repeat(40) },
    },
  );
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(stdout).toContain("child-output");
  expect(stderr).toContain("diagnostic publication failed");
  expect(exit).toBe(42);
});
