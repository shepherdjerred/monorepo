import path from "node:path";
import { Context } from "@temporalio/activity";
import * as Sentry from "@sentry/bun";
import type { GroomTask } from "#shared/docs-groom-types.ts";
import { getTraceContext } from "#observability/tracing.ts";
import { run } from "./docs-groom-utils.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const REPO = "shepherdjerred/monorepo";
const REPO_URL = `https://github.com/${REPO}.git`;
export const WORKTREE_BASE = "/tmp";

// ---------------------------------------------------------------------------
// Logging + Sentry
// ---------------------------------------------------------------------------

export type Phase =
  | "prepare"
  | "audit"
  | "implement"
  | "filter-open"
  | "validate"
  | "typecheck"
  | "commit"
  | "push"
  | "pr"
  | "cleanup";

function workflowFields(): Record<string, unknown> {
  // Activities always run inside a workflow context. Context.current()
  // throws if called outside one — that's an invariant, not a recoverable
  // condition.
  const info = Context.current().info;
  return {
    workflow: info.workflowType,
    workflowId: info.workflowExecution.workflowId,
    runId: info.workflowExecution.runId,
    activity: info.activityType,
    attempt: info.attempt,
  };
}

export function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  phase: Phase,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({
      level,
      msg: message,
      component: "temporal-worker",
      module: "docs-groom",
      phase,
      ...workflowFields(),
      ...getTraceContext(),
      ...fields,
    }),
  );
}

export function captureWithContext(
  error: unknown,
  phase: Phase,
  extra: Record<string, unknown> = {},
): void {
  Sentry.withScope((scope) => {
    const info = Context.current().info;
    scope.setTag("workflow", info.workflowType);
    scope.setTag("activity", info.activityType);
    scope.setTag("phase", phase);
    scope.setContext("docsGroom", {
      workflowId: info.workflowExecution.workflowId,
      runId: info.workflowExecution.runId,
      attempt: info.attempt,
      ...extra,
    });
    Sentry.captureException(error);
  });
}

export function taskSpanAttrs(
  worktreePath: string,
  task: GroomTask,
): Record<string, string> {
  return {
    "docsGroom.worktreePath": worktreePath,
    "docsGroom.task.slug": task.slug,
    "docsGroom.task.difficulty": task.difficulty,
    "docsGroom.task.category": task.category,
  };
}

// ---------------------------------------------------------------------------
// Worktree lifecycle (clone, commit, push, cleanup)
// ---------------------------------------------------------------------------

async function rmWorktree(p: string): Promise<void> {
  await run(["rm", "-rf", p], { throwOnError: false });
}

export async function doPrepareWorktree(
  runId: string,
  branch: string,
): Promise<{ path: string; baseSha: string }> {
  const worktreePath = path.join(WORKTREE_BASE, `groom-${runId}`);
  jsonLog("info", "Preparing worktree", "prepare", {
    path: worktreePath,
    branch,
  });

  await rmWorktree(worktreePath);
  await run(["mkdir", "-p", WORKTREE_BASE]);

  try {
    await run(["git", "clone", "--depth", "50", REPO_URL, worktreePath], {
      env: { GIT_TERMINAL_PROMPT: "0" },
    });
    await run(["git", "checkout", "-b", branch], { cwd: worktreePath });
    const baseShaResult = await run(["git", "rev-parse", "HEAD"], {
      cwd: worktreePath,
    });
    const baseSha = baseShaResult.stdout.trim();
    jsonLog("info", "Worktree ready", "prepare", {
      path: worktreePath,
      baseSha,
    });
    return { path: worktreePath, baseSha };
  } catch (error: unknown) {
    captureWithContext(error, "prepare", { path: worktreePath, branch });
    throw error;
  }
}

export async function doCommitAndPush(
  worktreePath: string,
  branch: string,
  message: string,
): Promise<void> {
  await run(["git", "add", "-A"], { cwd: worktreePath });
  await run(["git", "commit", "-m", message], { cwd: worktreePath });
  await run(["git", "push", "-u", "origin", branch], { cwd: worktreePath });
  jsonLog("info", "Pushed branch", "push", { branch });
}

export async function doCleanupWorktree(worktreePath: string): Promise<void> {
  if (!worktreePath.startsWith(`${WORKTREE_BASE}/groom-`)) {
    throw new Error(
      `cleanupWorktree refused: path "${worktreePath}" outside ${WORKTREE_BASE}/groom-*`,
    );
  }
  await rmWorktree(worktreePath);
  jsonLog("info", "Cleaned up worktree", "cleanup", { path: worktreePath });
}
