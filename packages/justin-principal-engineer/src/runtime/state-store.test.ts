import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { TaskStateSchema, type TaskState } from "#src/domain/schemas.ts";
import { runtimePaths } from "#src/runtime/paths.ts";
import { StateStore } from "#src/runtime/state-store.ts";
import { createTaskState } from "#src/host/task-state.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true });
    }),
  );
});

async function store(): Promise<StateStore> {
  const home = await mkdtemp(path.join(os.tmpdir(), "jpe-state-"));
  temporaryDirectories.push(home);
  return new StateStore(runtimePaths(home));
}

function state(): TaskState {
  return TaskStateSchema.parse({
    issue: {
      id: "issue-id",
      identifier: "SJ-1",
      title: "Small task",
      description: null,
      url: "https://linear.app/example/issue/SJ-1",
      priority: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      state: { name: "Todo", type: "unstarted" },
      labels: { nodes: [{ name: "agent:ready" }, { name: "agent:codex" }] },
    },
    provider: "codex",
    phase: "claimed",
    resumePhase: null,
    branch: "agent/sj-1-small-task",
    checkoutPath: "/tmp/sj-1",
    prNumber: null,
    prUrl: null,
    latestHeadSha: null,
    lastAgentOutput: null,
    pendingFeedback: [],
    pendingHealth: null,
    pendingDiagnostics: null,
    pendingCodexFindingKeys: [],
    restackInProgress: false,
    evidencePublished: false,
    evidenceMarkdown: [],
    seenFeedbackIds: [],
    failureCount: 0,
    lastFailureFingerprint: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

describe("StateStore", () => {
  test("persists typed task state atomically", async () => {
    const subject = await store();
    await subject.save(state());
    expect(await subject.list()).toEqual([state()]);
  });

  test("creates an excluded task root while preserving legacy checkouts", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "jpe-state-"));
    temporaryDirectories.push(home);
    const paths = runtimePaths(home);
    const legacy = {
      ...state(),
      checkoutPath: path.join(paths.root, "tasks", "sj-1"),
    };
    await mkdir(legacy.checkoutPath, { recursive: true });
    const sentinel = path.join(legacy.checkoutPath, "work-in-progress.txt");
    await Bun.write(sentinel, "unfinished work");
    const subject = new StateStore(paths);
    await subject.save(legacy);

    const next = createTaskState({
      issue: { ...legacy.issue, id: "next-issue", identifier: "SJ-2" },
      provider: "codex",
      paths,
    });
    await subject.save(next);

    expect(next.checkoutPath).toBe(
      path.join(paths.root, "tasks.noindex", "sj-2"),
    );
    const taskRoot = await stat(path.dirname(next.checkoutPath));
    expect(taskRoot.isDirectory()).toBe(true);
    expect(await subject.list()).toEqual([legacy, next]);
    expect(await Bun.file(sentinel).text()).toBe("unfinished work");
  });

  test("allows only one concurrent reconciler", async () => {
    const subject = await store();
    await subject.initialize();
    const acquired = Promise.withResolvers<undefined>();
    const released = Promise.withResolvers<undefined>();
    const held = subject.withLock(async () => {
      acquired.resolve(undefined);
      await released.promise;
    });
    await acquired.promise;
    expect(await subject.withLock(async () => "second")).toBeUndefined();
    released.resolve(undefined);
    await held;
    expect(await subject.withLock(async () => "third")).toBe("third");
  });

  test("releases the operating-system lock when work fails", async () => {
    const subject = await store();
    await expect(
      subject.withLock(() => {
        throw new Error("failed turn");
      }),
    ).rejects.toThrow("failed turn");
    expect(await subject.withLock(async () => "recovered")).toBe("recovered");
  });
});
