import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { TaskStateSchema } from "#src/domain/schemas.ts";
import {
  DEVEX_PROJECT_ID,
  autonomyIssueBlocker,
} from "#src/domain/autonomy.ts";
import { createTaskState } from "#src/host/task-state.ts";
import { StateStore } from "#src/runtime/state-store.ts";
import { runtimePaths } from "#src/runtime/paths.ts";
import { LinearClient } from "#src/integrations/linear.ts";
import { fakeLinearRunner } from "#src/integrations/fake-linear.ts";
import {
  assertRepairBudget,
  codingTurnStarted,
  blockAutonomousTask,
} from "#src/reconcile-autonomy.ts";

const issue = {
  id: "issue-1",
  identifier: "AI-104",
  title: "CLI help",
  description: null,
  url: "https://linear.app/example/issue/AI-104",
  priority: 1,
  team: { key: "AI" },
  project: { id: DEVEX_PROJECT_ID, name: "Developer Experience" },
  createdAt: "2026-01-01T00:00:00Z",
  state: { name: "Todo", type: "unstarted" },
  labels: { nodes: [{ name: "agent:codex" }, { name: "agent:autonomous" }] },
};

describe("autonomous authorization and recovery", () => {
  test("legacy snapshots keep owner approval and do not inherit autonomy from a label", () => {
    const state = createTaskState({
      paths: runtimePaths("/tmp/fixture"),
      issue,
      provider: "codex",
    });
    const {
      deliveryMode: _mode,
      repairTurnsUsed: _turns,
      implementationStarted: _started,
      ...legacy
    } = state;
    expect(TaskStateSchema.parse(legacy).deliveryMode).toBe("owner_approved");
    expect(autonomyIssueBlocker(issue)).toBeNull();
    expect(autonomyIssueBlocker({ ...issue, project: null })).not.toBeNull();
    expect(
      autonomyIssueBlocker({
        ...issue,
        labels: { nodes: [{ name: "agent:codex" }] },
      }),
    ).not.toBeNull();
  });

  test("one initial turn and three repairs survive a runner restart", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "justin-budget-"));
    const paths = runtimePaths(home);
    try {
      let state = createTaskState({
        paths,
        issue,
        provider: "codex",
        deliveryMode: "autonomous",
      });
      for (let turn = 0; turn < 4; turn += 1) {
        state = codingTurnStarted(state);
        await new StateStore(paths).save(state);
        const [persisted] = await new StateStore(paths).list();
        if (persisted === undefined) throw new Error("Missing persisted state");
        state = persisted;
        expect(state.repairTurnsUsed).toBe(turn);
      }
      expect(() => assertRepairBudget(state)).toThrow(
        "repair budget exhausted",
      );
    } finally {
      await rm(home, { recursive: true });
    }
  });

  test("temporary blocks back off and yield; permanent blocks have no retry", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "justin-block-"));
    const paths = runtimePaths(home);
    const store = new StateStore(paths);
    try {
      let state = {
        ...createTaskState({
          paths,
          issue,
          provider: "codex",
          deliveryMode: "autonomous",
        }),
        phase: "awaiting_ci" as const,
        resumePhase: null,
      };
      for (const delay of [5, 15, 60, 60]) {
        const before = Date.now();
        await blockAutonomousTask({
          state,
          reason: "Provider unavailable",
          retryable: true,
          linear: new LinearClient("AI", fakeLinearRunner()),
          store,
        });
        const [saved] = await store.list();
        if (saved === undefined) throw new Error("Missing retry state");
        if (saved.nextAttemptAt === null) throw new Error("Missing retry time");
        expect(Date.parse(saved.nextAttemptAt) - before).toBeGreaterThanOrEqual(
          delay * 60_000,
        );
        expect(saved.phase).toBe("blocked");
        expect(saved.resumePhase).toBe("awaiting_ci");
        state = { ...saved, phase: "awaiting_ci", resumePhase: null };
      }
      await blockAutonomousTask({
        state,
        reason: "Budget exhausted",
        linear: new LinearClient("AI", fakeLinearRunner()),
        store,
      });
      const final = await store.list();
      expect(final[0]?.nextAttemptAt).toBeNull();
    } finally {
      await rm(home, { recursive: true });
    }
  });
});
