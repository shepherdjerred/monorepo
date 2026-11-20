import { buildAgentPrompt } from "#src/agent/prompt.ts";
import { publicAgentOutput } from "#src/agent/public-output.ts";
import { MAX_REPAIR_TURNS } from "#src/domain/autonomy.ts";
import type { TaskState, AgentOutput } from "#src/domain/schemas.ts";
import type { DockerAgentRunner } from "#src/host/docker.ts";
import type { GitWorkspace } from "#src/host/git-workspace.ts";
import type { TrackerClient } from "#src/integrations/tracker.ts";
import type { StateStore } from "#src/runtime/state-store.ts";
import { writeInfo } from "#src/runtime/output.ts";
import { codingTurnStarted } from "#src/reconcile-autonomy.ts";
import * as reconcileMerge from "#src/reconcile-merge.ts";
import {
  hasNewAttemptContext,
  passTask,
  privateEvidence,
  snapshotAttempt,
} from "#src/reconcile-pass.ts";

async function completeUnchangedTurn(
  input: Parameters<typeof implementTask>[0],
  state: TaskState,
  output: AgentOutput,
  seenFeedbackIds: string[],
): Promise<void> {
  const persistedOutput = publicAgentOutput(output);
  if (state.prNumber === null) {
    const verification = output.verification
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (output.status !== "no_change" || verification.length === 0) {
      await passTask({
        state,
        reason: "unverified_no_change",
        note: "The coding turn produced neither a reviewable change nor evidence that the requested behavior already exists. Add the expected result and a way to verify it.",
        store: input.store,
      });
      return;
    }
    const current = await input.tracker.issueContext(state.issue.identifier);
    if (current === null || state.attemptContext === undefined)
      throw new Error("No Tracker context to confirm no-change completion");
    if (
      current.issue.archivedAt != null ||
      ["completed", "canceled", "duplicate"].includes(current.issue.state.type)
    ) {
      await input.save(state, "done", { issue: current.issue });
      return;
    }
    if (hasNewAttemptContext(state.attemptContext, snapshotAttempt(current))) {
      await passTask({
        state,
        reason: "context_changed",
        note: "The issue changed during the coding turn. Justin will verify the revised request before completing it.",
        store: input.store,
      });
      return;
    }
    await reconcileMerge.completeNoChangeTurn({
      state: {
        ...state,
        issue: current.issue,
        noChangeEvidence: privateEvidence(
          [output.summary, ...verification.map((entry) => `- ${entry}`)].join(
            "\n",
          ),
        ),
      },
      output: persistedOutput,
      tracker: input.tracker,
      save: input.save,
      writeInfo,
    });
    return;
  }
  if (state.pendingHealth !== null || state.pendingFeedback.length > 0) {
    const reason =
      state.pendingHealth === null
        ? "unresolved_feedback"
        : "verification_failed";
    await passTask({
      state,
      reason,
      note: [
        "The coding turn made no change to address the pending CI failure or review feedback.",
        output.summary,
        ...output.verification,
      ].join("\n"),
      store: input.store,
    });
    return;
  }
  await input.save(state, "awaiting_ci", {
    autonomyReviewPending: false,
    lastAgentOutput: persistedOutput,
    pendingFeedback: [],
    pendingHealth: null,
    pendingDiagnostics: null,
    pendingCodexFindingKeys: [],
    seenFeedbackIds,
  });
}

export async function implementTask(input: {
  state: TaskState;
  tracker: TrackerClient;
  git: GitWorkspace;
  agent: DockerAgentRunner;
  store: StateStore;
  save: (
    state: TaskState,
    phase: TaskState["phase"],
    patch?: Partial<TaskState>,
  ) => Promise<TaskState>;
}): Promise<void> {
  let { state } = input;
  const context = await input.tracker.issueContext(state.issue.identifier);
  if (context === null) throw new Error("Task's Tracker issue disappeared");
  if (
    state.implementationStarted &&
    state.repairTurnsUsed >= MAX_REPAIR_TURNS
  ) {
    await passTask({
      state: {
        ...state,
        attemptContext: state.attemptContext ?? snapshotAttempt(context),
      },
      reason: "repair_budget",
      note: `The initial coding turn and ${String(MAX_REPAIR_TURNS)} follow-up turns did not resolve the issue. Add the missing information or a narrower verification target before Justin retries.`,
      store: input.store,
    });
    return;
  }
  state = {
    ...state,
    issue: context.issue,
    attemptContext: snapshotAttempt(context),
  };
  const output = await input.agent.runTurn({
    checkout: state.checkoutPath,
    provider: state.provider,
    onStart: async () => {
      state = codingTurnStarted(state);
      await input.store.save(state);
    },
    prompt: buildAgentPrompt({
      state,
      trackerContext: context.prompt,
      feedback: state.pendingFeedback,
      ...(state.pendingHealth === null ? {} : { health: state.pendingHealth }),
      ...(state.pendingDiagnostics === null
        ? {}
        : { diagnostics: state.pendingDiagnostics }),
    }),
  });
  const persistedOutput = publicAgentOutput(output);
  if (output.status === "pass" || output.status === "needs_human") {
    await passTask({
      state,
      reason: "agent_pass",
      note: [
        "Coding turn report",
        "",
        output.summary,
        ...output.verification.map((entry) => `- ${entry}`),
      ].join("\n"),
      store: input.store,
    });
    return;
  }
  const changed =
    state.prNumber === null || state.lastPass?.closedPullRequest === true
      ? await input.git.publicationPaths(state.checkoutPath)
      : await input.git.changedPaths(state.checkoutPath);
  const seenFeedbackIds = [
    ...new Set([
      ...state.seenFeedbackIds,
      ...state.pendingFeedback.map(({ id }) => id),
    ]),
  ];
  if (changed.length === 0) {
    await completeUnchangedTurn(input, state, output, seenFeedbackIds);
    return;
  }
  await input.save(state, "publishing", {
    autonomyReviewPending: false,
    lastAgentOutput: persistedOutput,
    pendingFeedback: [],
    pendingHealth: null,
    pendingDiagnostics: null,
    pendingCodexFindingKeys: state.pendingCodexFindingKeys,
    evidencePublished: false,
    evidenceMarkdown: [],
    seenFeedbackIds,
  });
  writeInfo(`${state.issue.identifier}: agent turn completed; publishing next`);
}
