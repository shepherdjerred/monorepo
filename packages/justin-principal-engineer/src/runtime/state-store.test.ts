import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import type { TaskState } from "#src/domain/schemas.ts";
import { runtimePaths } from "#src/runtime/paths.ts";
import { StateStore } from "#src/runtime/state-store.ts";

const temporaryDirectories: string[] = [];
const noOp = (): void => undefined;

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
  return {
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
  };
}

describe("StateStore", () => {
  test("persists typed task state atomically", async () => {
    const subject = await store();
    await subject.save(state());
    expect(await subject.list()).toEqual([state()]);
  });

  test("allows only one concurrent reconciler", async () => {
    const subject = await store();
    await subject.initialize();
    let release = noOp;
    const held = subject.withLock(
      async () =>
        await new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await Bun.sleep(10);
    expect(await subject.withLock(async () => "second")).toBeUndefined();
    release();
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
