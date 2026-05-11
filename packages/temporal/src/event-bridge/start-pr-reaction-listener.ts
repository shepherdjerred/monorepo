import type { Client } from "@temporalio/client";
import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
} from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";

/**
 * Idempotently starts the long-running pr-review reaction-listener
 * workflow (Phase 9). One execution per repo set; identified by a fixed
 * workflow ID so worker restarts don't pile up duplicates.
 *
 * The workflow runs forever (continue-as-new every ~24h to keep history
 * bounded). If it errors fatally, the worker process exits, K8s restarts
 * the pod, and `start-pr-reaction-listener` boots a fresh run on next
 * worker startup.
 *
 * Repository list is sourced from `PR_REVIEW_LISTENER_REPOS` (CSV of
 * `owner/repo`). Empty / unset → no-op (production wiring just sets it
 * to `shepherdjerred/monorepo`).
 */
export async function startPrReactionListener(client: Client): Promise<void> {
  const reposRaw = Bun.env["PR_REVIEW_LISTENER_REPOS"] ?? "";
  if (reposRaw.trim() === "") {
    console.warn(
      "PR_REVIEW_LISTENER_REPOS unset; pr-review reaction-listener disabled",
    );
    return;
  }
  const repositories = reposRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((entry) => {
      const [owner, repo] = entry.split("/");
      if (
        owner === undefined ||
        owner === "" ||
        repo === undefined ||
        repo === ""
      ) {
        throw new Error(
          `PR_REVIEW_LISTENER_REPOS entry "${entry}" is not owner/repo`,
        );
      }
      return { owner, repo };
    });
  if (repositories.length === 0) return;

  const workflowId = "pr-review-reaction-listener";
  try {
    await client.workflow.start("prReactionListener", {
      taskQueue: TASK_QUEUES.PR_REVIEW,
      workflowId,
      // Self-recycle via continue-as-new; reusing the same ID across
      // restarts is the documented pattern for "exactly one running".
      workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
      args: [{ repositories }],
    });
    console.warn(
      `Started pr-review reaction listener for ${String(repositories.length)} repos`,
    );
  } catch (error: unknown) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) {
      console.warn(
        `pr-review reaction listener already running (id=${workflowId})`,
      );
      return;
    }
    throw error;
  }
}
