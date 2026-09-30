import { describe, expect, test } from "vitest";

import type { LinearIssue, TaskState } from "#src/domain/schemas.ts";
import { fakeLinearRunner } from "#src/integrations/fake-linear.ts";
import { LinearClient } from "#src/integrations/linear.ts";
import { pauseTask } from "#src/reconcile-merge.ts";

function state(): TaskState {
  const issue: LinearIssue = {
    id: "node-1",
    identifier: "XX-1",
    title: "XX-1",
    description: null,
    url: "https://linear.app/example/issue/XX-1",
    priority: 0,
    team: { key: "SJ" },
    createdAt: "2026-01-01T00:00:00.000Z",
    state: { name: "In Progress", type: "started" },
    labels: { nodes: [{ name: "agent:codex" }] },
  };
  return {
    issue,
    provider: "codex",
    phase: "implementing",
    resumePhase: null,
    branch: "agent/xx-1",
    checkoutPath: "/tmp/xx-1",
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
    failureCount: 2,
    lastFailureFingerprint: "abc",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("pauseTask", () => {
  test("saves needs_human after the label lands", async () => {
    const saved: TaskState[] = [];
    const linear = new LinearClient("SJ", fakeLinearRunner());
    await pauseTask({
      state: state(),
      reason: "reason",
      linear,
      store: {
        save: (next: TaskState): Promise<void> => {
          saved.push(next);
          return Promise.resolve();
        },
      },
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]?.phase).toBe("needs_human");
    expect(saved[0]?.resumePhase).toBe("implementing");
  });

  test("leaves runnable state when the label mutation fails", async () => {
    const saved: TaskState[] = [];
    const linear = new LinearClient(
      "SJ",
      fakeLinearRunner([], { mutateSuccess: false }),
    );
    await expect(
      pauseTask({
        state: state(),
        reason: "reason",
        linear,
        store: {
          save: (next: TaskState): Promise<void> => {
            saved.push(next);
            return Promise.resolve();
          },
        },
      }),
    ).rejects.toThrow(/label mutation failed/);
    expect(saved).toEqual([]);
  });

  test("rolls the label back when the save fails", async () => {
    const calls: string[][] = [];
    const linear = new LinearClient("SJ", fakeLinearRunner(calls));
    await expect(
      pauseTask({
        state: state(),
        reason: "reason",
        linear,
        store: {
          save: (): Promise<void> => Promise.reject(new Error("disk is full")),
        },
      }),
    ).rejects.toThrow(/disk is full/);
    const mutations = calls.filter(
      (args) => args[2] === "api" && args[3]?.includes("issueUpdate") === true,
    );
    expect(mutations).toHaveLength(2);
    const variables = mutations.map((call) =>
      JSON.parse(call[call.indexOf("--variables-json") + 1] ?? "{}"),
    );
    expect(variables[0]).toEqual({
      id: "node-1",
      add: ["sj-needs-human-id"],
      remove: [],
    });
    expect(variables[1]).toEqual({
      id: "node-1",
      add: [],
      remove: ["sj-needs-human-id"],
    });
  });
});
