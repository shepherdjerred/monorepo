import { buildAgentPrompt } from "#src/agent/prompt.ts";
import { publicAgentOutput } from "#src/agent/public-output.ts";
import { AutonomousBlocker } from "#src/domain/autonomy.ts";
import type { TaskState, AgentOutput } from "#src/domain/schemas.ts";
import type { DockerAgentRunner } from "#src/host/docker.ts";
import type { GitWorkspace } from "#src/host/git-workspace.ts";
import type { LinearClient } from "#src/integrations/linear.ts";
import type { StateStore } from "#src/runtime/state-store.ts";
import { writeInfo } from "#src/runtime/output.ts";
import {
  assertRepairBudget,
  codingTurnStarted,
} from "#src/reconcile-autonomy.ts";
import * as reconcileMerge from "#src/reconcile-merge.ts";

async function completeUnchangedTurn(
  input: Parameters<typeof implementTask>[0],
  state: TaskState,
  output: AgentOutput,
  seenFeedbackIds: string[],
): Promise<void> {
  const persistedOutput = publicAgentOutput(output);
  if (state.prNumber === null) {
    if (state.deliveryMode === "autonomous")
      throw new AutonomousBlocker(
        "No reviewable change was produced; autonomous completion requires a confirmed merge",
      );
    if (output.status !== "no_change") {
      throw new Error(`Agent reported ${output.status} without a change`);
    }
    await reconcileMerge.completeNoChangeTurn({
      state,
      output: persistedOutput,
      linear: input.linear,
      save: input.save,
      writeInfo,
    });
    return;
  }
  if (state.pendingHealth !== null)
    throw new Error(`Agent made no change: ${output.summary}`);
  if (state.pendingFeedback.length > 0) {
    if (state.deliveryMode === "autonomous")
      throw new AutonomousBlocker(
        "The agent produced no change after feedback",
      );
    await reconcileMerge.pauseAfterNoChangeFeedback({
      state,
      linear: input.linear,
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
  linear: LinearClient;
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
  assertRepairBudget(state);
  const linearContext = await input.linear.agentContext(state.issue.identifier);
  const output = await input.agent.runTurn({
    checkout: state.checkoutPath,
    provider: state.provider,
    onStart: async () => {
      if (state.deliveryMode !== "autonomous") return;
      state = codingTurnStarted(state);
      await input.store.save(state);
    },
    prompt: buildAgentPrompt({
      state,
      linearContext,
      feedback: state.pendingFeedback,
      ...(state.pendingHealth === null ? {} : { health: state.pendingHealth }),
      ...(state.pendingDiagnostics === null
        ? {}
        : { diagnostics: state.pendingDiagnostics }),
    }),
  });
  const persistedOutput = publicAgentOutput(output);
  if (output.status === "needs_human") {
    if (state.deliveryMode === "autonomous")
      throw new AutonomousBlocker(output.summary);
    await reconcileMerge.pauseTask({
      state,
      reason: persistedOutput.summary,
      linear: input.linear,
      store: input.store,
    });
    return;
  }
  const changed = await input.git.changedPaths(state.checkoutPath);
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
