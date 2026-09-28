import { describe, expect, test } from "vitest";

import type { LinearIssue, TaskState } from "#src/domain/schemas.ts";
import { LinearClient } from "#src/integrations/linear.ts";
import { pauseTask } from "#src/reconcile-merge.ts";
import type { CommandRunner } from "#src/runtime/process.ts";

function runner(mutateSuccess: boolean): CommandRunner {
  return async (args) => {
    if (args[2] === "label") {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          nodes: [{ id: "nh-id", name: "agent:needs-human" }],
        }),
        stderr: "",
        timedOut: false,
      };
    }
    if (args[2] === "api") {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          data: { issueUpdate: { success: mutateSuccess } },
        }),
        stderr: "",
        timedOut: false,
      };
    }
    return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
  };
}

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
    const linear = new LinearClient("SJ", runner(true));
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
    const linear = new LinearClient("SJ", runner(false));
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
});
