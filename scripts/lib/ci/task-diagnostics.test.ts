import { cp, mkdtemp, mkdir, rm, truncate, utimes } from "node:fs/promises";
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

test("accepts large repository summaries while stripping their input payload", async () => {
  const root = await repository();
  await Bun.write(
    path.join(root, ".turbo/runs/large.json"),
    JSON.stringify({
      ...summary(),
      ignoredInputs: "x".repeat(21 * 1024 * 1024),
    }),
  );
  const report = await collectTaskDiagnostics(identity, new Set(), root);
  expect(report.collectionFailed).toBe(false);
  expect(report.turbo).toHaveLength(1);
  expect(JSON.stringify(report)).not.toContain("ignoredInputs");
  expect(JSON.stringify(report).length).toBeLessThan(2000);
});

test("rejects oversized summaries before parsing or allocating their payload", async () => {
  const root = await repository();
  const file = path.join(root, ".turbo/runs/oversized.json");
  await Bun.write(file, "{}");
  await truncate(file, 128 * 1024 * 1024 + 1);
  await expect(
    collectTaskDiagnostics(identity, new Set(), root),
  ).rejects.toThrow("Diagnostic input exceeds its size limit");
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

async function runWrapper(
  root: string,
  entrypoint: string,
  command: string[],
  options?: { mode: string[]; env: Record<string, string> },
) {
  const child = Bun.spawn(
    [
      process.execPath,
      "--no-install",
      entrypoint,
      ...(options?.mode ?? ["verify", "--"]),
      ...command,
    ],
    {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      env: options?.env ?? {
        CI_PIPELINE_NUMBER: "123",
        CI_COMMIT_SHA: "a".repeat(40),
      },
    },
  );
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exit };
}

test.each([
  { mode: ["invalid"], message: "Usage: run-with-diagnostics.ts" },
  {
    mode: ["verify", "--", "unused"],
    message: "require a pipeline number and full commit SHA",
  },
  {
    mode: ["--retain", '{"pipeline":"sentinel-secret"}', "[]"],
    message: "CI task diagnostic process failed",
  },
])(
  "reports safe wrapper errors and hides rejected values: $message",
  async ({ mode, message }) => {
    const { stderr, exit } = await runWrapper(
      await repository(),
      new URL("../../ci/run-with-diagnostics.ts", import.meta.url).pathname,
      [],
      { mode, env: { CI_PIPELINE_NUMBER: "", CI_COMMIT_SHA: "" } },
    );
    expect(exit).toBe(1);
    expect(stderr).toContain(message);
    expect(stderr).not.toContain("sentinel-secret");
  },
);

test("wrapper forwards command output and preserves its exit without upload credentials", async () => {
  const root = await repository();
  const { stdout, stderr, exit } = await runWrapper(
    root,
    new URL("../../ci/run-with-diagnostics.ts", import.meta.url).pathname,
    [process.execPath, "-e", "console.log('child-output'); process.exit(42)"],
  );
  expect(stdout).toContain("child-output");
  expect(stderr).toContain("diagnostic publication failed");
  expect(exit).toBe(42);
});

test.each([0, 42])(
  "collects in a fresh process after the child installs dependencies and exits %i",
  async (exitCode) => {
    const root = await repository();
    const entrypoint = path.join(root, "scripts/ci/run-with-diagnostics.ts");
    const library = path.join(root, "scripts/lib/ci");
    await mkdir(path.dirname(entrypoint), { recursive: true });
    await mkdir(library, { recursive: true });
    await cp(
      new URL("../../ci/run-with-diagnostics.ts", import.meta.url),
      entrypoint,
    );
    await cp(
      new URL("task-diagnostics.ts", import.meta.url),
      path.join(library, "task-diagnostics.ts"),
    );
    // Fake only the object-store boundary; the wrapper and collector run as
    // real subprocesses from a checkout with no installed dependencies.
    await Bun.write(
      path.join(library, "ci-handoff.ts"),
      'export async function writeJsonHandoff(key, report) { await Bun.write("published.json", JSON.stringify(report)); }',
    );
    await Bun.write(
      path.join(library, "ci-object-store-retry.ts"),
      "export class CiObjectStoreHttpError extends Error {}\nexport async function withCiObjectStoreRetry(operation) { return operation(); }",
    );
    const dependencies = new URL("../../node_modules", import.meta.url)
      .pathname;
    const install = `
      import { symlink } from "node:fs/promises";
      await symlink(${JSON.stringify(dependencies)}, "scripts/node_modules");
      await Bun.write(".turbo/runs/child.json", ${JSON.stringify(JSON.stringify(summary()))});
      process.exit(${String(exitCode)});
    `;
    const { stdout, stderr, exit } = await runWrapper(root, entrypoint, [
      process.execPath,
      "-e",
      install,
    ]);
    expect(stderr).toBe("");
    expect(stdout).toContain("CI task diagnostics:");
    expect(exit).toBe(exitCode);
    const report: unknown = await Bun.file(
      path.join(root, "published.json"),
    ).json();
    expect(report).toMatchObject({
      pipeline: "123",
      exitCode,
      collectionFailed: false,
      turbo: [{ id: "run-one" }],
    });
    expect(JSON.stringify(report)).not.toContain("sentinel");
  },
);
