import {
  ChildWorkflowCancellationType,
  ParentClosePolicy,
  proxyActivities,
  startChild,
  workflowInfo,
} from "@temporalio/workflow";
import type { DocsGroomActivities } from "#activities/docs-groom.ts";
import { buildPrBody } from "#activities/docs-groom-pr.ts";
import type { GroomTask } from "#shared/docs-groom-types.ts";

const {
  prepareWorktree,
  invokeClaudeGroom,
  invokeClaudeImplement,
  filterAlreadyOpen,
  validateChanges,
  typecheckIfCodeTouched,
  commitAndPush,
  openDraftPr,
  cleanupWorktree,
  recordRunOutcome,
} = proxyActivities<DocsGroomActivities>({
  // Per-activity timeouts; overridden inline below where the default is wrong.
  startToCloseTimeout: "5 minutes",
  retry: {
    maximumAttempts: 2,
    initialInterval: "5 seconds",
    backoffCoefficient: 2,
  },
});

const { invokeClaudeGroom: invokeClaudeGroomLong } =
  proxyActivities<DocsGroomActivities>({
    startToCloseTimeout: "30 minutes",
    heartbeatTimeout: "30 seconds",
    retry: { maximumAttempts: 1 },
  });

const { invokeClaudeImplement: invokeClaudeImplementLong } =
  proxyActivities<DocsGroomActivities>({
    startToCloseTimeout: "30 minutes",
    heartbeatTimeout: "30 seconds",
    retry: { maximumAttempts: 1 },
  });

const { typecheckIfCodeTouched: typecheckLong } =
  proxyActivities<DocsGroomActivities>({
    startToCloseTimeout: "10 minutes",
    heartbeatTimeout: "90 seconds",
    retry: { maximumAttempts: 1 },
  });

void invokeClaudeGroom;
void invokeClaudeImplement;
void typecheckIfCodeTouched;

const MAX_IMPLEMENTATION_TASKS_PER_RUN = 5;
const PR_LABEL = "docs-groom";
const PR_LABEL_TASK = "docs-groom-task";

export type DocsGroomAuditResult = {
  groomingPr: { url: string; number: number } | null;
  implementationPrs: {
    taskSlug: string;
    pr: { url: string; number: number };
  }[];
  hardTasks: GroomTask[];
  /** Tasks dropped by filterAlreadyOpen — surfaced for visibility. */
  filteredOutTasks: GroomTask[];
};

export type DocsGroomTaskResult = {
  pr: { url: string; number: number } | null;
  filesChanged: string[];
  /** Set when the run terminated without opening a PR (validation failure, etc.). */
  skippedReason?: string;
};

function todayIsoDate(): string {
  // Workflow code must be deterministic. workflowInfo().runStartTime is the
  // server-recorded start time and is replay-safe.
  const startMs = workflowInfo().runStartTime.getTime();
  return new Date(startMs).toISOString().slice(0, 10);
}

/**
 * Daily docs-groom audit workflow:
 *   1. claude -p does in-place grooming → grooming PR
 *   2. claude returns a list of larger tasks
 *   3. easy/medium tasks are dispatched as child workflows
 *   4. hard tasks are returned for visibility
 */
export async function runDocsGroomAudit(): Promise<DocsGroomAuditResult> {
  const info = workflowInfo();
  const date = todayIsoDate();
  const branch = `docs-groom/daily-${date}`;

  let groomingPr: DocsGroomAuditResult["groomingPr"] = null;
  const implementationPrs: DocsGroomAuditResult["implementationPrs"] = [];
  // hardTasks / filteredOutTasks are reassigned before the return inside
  // the try block. If the try throws, we never read them — declare without
  // initializer so eslint(no-useless-assignment) doesn't flag a wasted `[]`.
  let hardTasks: GroomTask[];
  let filteredOutTasks: GroomTask[];
  let worktreePath: string | undefined;
  let success = false;

  try {
    const prepared = await prepareWorktree(info.workflowId, branch);
    worktreePath = prepared.path;

    const groomResult = await invokeClaudeGroomLong(prepared.path);

    // Open the grooming PR only if Claude actually changed something.
    const validation = await validateChanges(prepared.path, branch);
    if (validation.ok) {
      if (validation.touchesCode) {
        const tcResult = await typecheckLong(
          prepared.path,
          validation.changedFiles,
        );
        if (!tcResult.ok) {
          throw new Error(`grooming typecheck failed:\n${tcResult.output}`);
        }
      }
      const pushed = await commitAndPush(
        prepared.path,
        branch,
        `docs(docs): daily docs-groom pass ${date}`,
      );
      if (pushed) {
        groomingPr = await openDraftPr({
          branch,
          title: `docs(docs): daily docs-groom pass ${date}`,
          body: buildPrBody({
            kind: "grooming",
            workflowId: info.workflowId,
            runId: info.runId,
            summary: groomResult.summary,
            filesChanged: groomResult.groomedFiles,
          }),
          labels: [PR_LABEL],
          kind: "grooming",
        });
      }
    }

    // Fan out: only easy/medium tasks become child workflows.
    const candidateTasks = groomResult.tasks.filter(
      (t) => t.difficulty === "easy" || t.difficulty === "medium",
    );
    hardTasks = groomResult.tasks.filter((t) => t.difficulty === "hard");

    const filterResult = await filterAlreadyOpen(candidateTasks);
    filteredOutTasks = candidateTasks.filter(
      (t) => !filterResult.some((kept) => kept.slug === t.slug),
    );
    const tasksToImplement = filterResult.slice(
      0,
      MAX_IMPLEMENTATION_TASKS_PER_RUN,
    );

    // Run children sequentially to avoid swamping the worker pool with
    // multiple concurrent claude -p invocations (each is CPU-heavy). The
    // overall parent workflow has a 2h timeout which comfortably covers
    // 5 children at up to 25 min each.
    for (const task of tasksToImplement) {
      try {
        const handle = await startChild(runDocsGroomTask, {
          args: [{ task, parentRunId: info.runId }],
          workflowId: `docs-groom-task-${task.slug}-${date}-${info.runId.slice(0, 8)}`,
          taskQueue: info.taskQueue,
          // 30 min claude run + setup/validate/typecheck/PR overhead
          workflowExecutionTimeout: "45 minutes",
          parentClosePolicy: ParentClosePolicy.TERMINATE,
          cancellationType:
            ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
        });
        const childResult = await handle.result();
        if (childResult.pr !== null) {
          implementationPrs.push({ taskSlug: task.slug, pr: childResult.pr });
        }
      } catch {
        // Don't fail the whole parent run because one child failed; the
        // child workflow has its own error visibility in the Temporal UI
        // and Bugsink.
      }
    }

    success = true;
    return {
      groomingPr,
      implementationPrs,
      hardTasks,
      filteredOutTasks,
    };
  } finally {
    if (worktreePath !== undefined) {
      try {
        await cleanupWorktree(worktreePath);
      } catch {
        // Best effort.
      }
    }
    await recordRunOutcome("audit", success ? "success" : "failure");
  }
}

/**
 * Per-task implementation workflow:
 *   1. fresh worktree off main
 *   2. claude -p implements one task
 *   3. validate + typecheck
 *   4. commit + push + draft PR
 */
export async function runDocsGroomTask(input: {
  task: GroomTask;
  parentRunId: string;
}): Promise<DocsGroomTaskResult> {
  const info = workflowInfo();
  const date = todayIsoDate();
  const branch = `docs-groom/${input.task.slug}-${date}`;

  let worktreePath: string | undefined;
  let success = false;
  let pr: { url: string; number: number } | null = null;
  // filesChanged is always assigned from implResult.filesChanged before any
  // return path inside the try. If the activity throws first, we never read
  // it — declare without initializer so eslint(no-useless-assignment) is
  // happy.
  let filesChanged: string[];
  let skippedReason: string | undefined;

  try {
    const prepared = await prepareWorktree(info.workflowId, branch);
    worktreePath = prepared.path;

    const implResult = await invokeClaudeImplementLong(
      prepared.path,
      input.task,
    );
    filesChanged = implResult.filesChanged;

    const validation = await validateChanges(prepared.path, branch);
    if (!validation.ok) {
      skippedReason = `validateChanges rejected: ${validation.reason}`;
      success = true; // ran cleanly, just no PR
      return { pr, filesChanged, skippedReason };
    }

    if (validation.touchesCode) {
      const tcResult = await typecheckLong(
        prepared.path,
        validation.changedFiles,
      );
      if (!tcResult.ok) {
        skippedReason = `typecheck failed:\n${tcResult.output.slice(0, 1500)}`;
        success = true; // workflow ran; just blocked on typecheck
        return { pr, filesChanged, skippedReason };
      }
    }

    const pushed = await commitAndPush(
      prepared.path,
      branch,
      `docs(docs): ${input.task.title}`,
    );
    if (pushed) {
      pr = await openDraftPr({
        branch,
        title: `docs(docs): ${input.task.title}`,
        body: buildPrBody({
          kind: "implementation",
          workflowId: info.workflowId,
          runId: info.runId,
          task: input.task,
          summary: implResult.summary,
          filesChanged: implResult.filesChanged,
        }),
        labels: [PR_LABEL, PR_LABEL_TASK],
        kind: "implementation",
      });
    } else {
      skippedReason = "validateChanges saw a diff but nothing was staged";
    }
    success = true;
    return {
      pr,
      filesChanged,
      ...(skippedReason === undefined ? {} : { skippedReason }),
    };
  } finally {
    if (worktreePath !== undefined) {
      try {
        await cleanupWorktree(worktreePath);
      } catch {
        // Best effort.
      }
    }
    await recordRunOutcome("task", success ? "success" : "failure");
  }
}
