import type {
  GroomResult,
  GroomTask,
  ImplementResult,
} from "#shared/docs-groom-types.ts";
import { docsGroomRunsTotal } from "#observability/metrics.ts";
import { withSpan } from "#observability/tracing.ts";
import {
  doInvokeClaudeGroom,
  doInvokeClaudeImplement,
} from "./docs-groom-claude.ts";
import {
  doCleanupWorktree,
  doCommitAndPush,
  doPrepareWorktree,
  jsonLog,
  taskSpanAttrs,
} from "./docs-groom-impl.ts";
import {
  doFilterAlreadyOpen,
  doOpenDraftPr,
  type OpenDraftPrInput,
} from "./docs-groom-pr.ts";
import {
  doTypecheckIfCodeTouched,
  doValidateChanges,
  type TypecheckResult,
  type ValidateResult,
} from "./docs-groom-validate.ts";

export type DocsGroomActivities = typeof docsGroomActivities;

export const docsGroomActivities = {
  async prepareWorktree(
    runId: string,
    branch: string,
  ): Promise<{ path: string; baseSha: string }> {
    return await withSpan(
      "docs-groom.prepareWorktree",
      { "docsGroom.runId": runId, "docsGroom.branch": branch },
      async () => doPrepareWorktree(runId, branch),
    );
  },

  async invokeClaudeGroom(worktreePath: string): Promise<GroomResult> {
    return await withSpan(
      "docs-groom.invokeClaudeGroom",
      { "docsGroom.worktreePath": worktreePath },
      async () => doInvokeClaudeGroom(worktreePath),
    );
  },

  async invokeClaudeImplement(
    worktreePath: string,
    task: GroomTask,
  ): Promise<ImplementResult> {
    return await withSpan(
      "docs-groom.invokeClaudeImplement",
      taskSpanAttrs(worktreePath, task),
      async () => doInvokeClaudeImplement(worktreePath, task),
    );
  },

  async filterAlreadyOpen(tasks: GroomTask[]): Promise<GroomTask[]> {
    return await withSpan(
      "docs-groom.filterAlreadyOpen",
      { "docsGroom.taskCount": tasks.length },
      async () => doFilterAlreadyOpen(tasks),
    );
  },

  async validateChanges(
    worktreePath: string,
    branch: string,
  ): Promise<ValidateResult> {
    return await withSpan(
      "docs-groom.validateChanges",
      { "docsGroom.worktreePath": worktreePath, "docsGroom.branch": branch },
      async () => doValidateChanges(worktreePath, branch),
    );
  },

  async typecheckIfCodeTouched(
    worktreePath: string,
    changedFiles: string[],
  ): Promise<TypecheckResult> {
    return await withSpan(
      "docs-groom.typecheckIfCodeTouched",
      { "docsGroom.worktreePath": worktreePath },
      async () => doTypecheckIfCodeTouched(worktreePath, changedFiles),
    );
  },

  async commitAndPush(
    worktreePath: string,
    branch: string,
    message: string,
  ): Promise<void> {
    await withSpan(
      "docs-groom.commitAndPush",
      { "docsGroom.worktreePath": worktreePath, "docsGroom.branch": branch },
      async () => doCommitAndPush(worktreePath, branch, message),
    );
  },

  async openDraftPr(
    input: OpenDraftPrInput,
  ): Promise<{ url: string; number: number }> {
    return await withSpan(
      "docs-groom.openDraftPr",
      { "docsGroom.branch": input.branch, "docsGroom.kind": input.kind },
      async () => doOpenDraftPr(input),
    );
  },

  /**
   * Emit the docs_groom_runs_total counter for one workflow attempt.
   * Workflows are sandboxed and can't access prom-client directly, so
   * they call this thin activity at completion (or in catch blocks).
   */
  recordRunOutcome(
    phase: "audit" | "task",
    outcome: "success" | "failure" | "skipped",
  ): Promise<void> {
    docsGroomRunsTotal.inc({ phase, outcome });
    jsonLog("info", "Recorded run outcome", "validate", { phase, outcome });
    return Promise.resolve();
  },

  async cleanupWorktree(worktreePath: string): Promise<void> {
    await withSpan(
      "docs-groom.cleanupWorktree",
      { "docsGroom.path": worktreePath },
      async () => doCleanupWorktree(worktreePath),
    );
  },
};
