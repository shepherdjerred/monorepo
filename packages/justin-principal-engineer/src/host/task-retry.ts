import {
  autonomyIssueBlocker,
  AutonomousBlocker,
  MAX_REPAIR_TURNS,
} from "#src/domain/autonomy.ts";
import type { TaskState } from "#src/domain/schemas.ts";
import { autonomyEnabled } from "#src/host/autonomy-policy.ts";
import type { LinearClient } from "#src/integrations/linear.ts";
import type { RuntimePaths } from "#src/runtime/paths.ts";
import type { StateStore } from "#src/runtime/state-store.ts";
import { currentTimestamp } from "#src/runtime/time.ts";
import { writeInfo } from "#src/runtime/output.ts";

/** Explicit operator retry preserves the continuation, output, and coding budget. */
export async function retryBlockedTask(input: {
  identifier: string;
  paths: RuntimePaths;
  store: StateStore;
  linear: Pick<LinearClient, "refreshIssue">;
  checkScope: (state: TaskState) => Promise<void>;
}): Promise<void> {
  const queued = await input.store.withLock(async () => {
    const states = await input.store.list();
    const state = states.find((s) => s.issue.identifier === input.identifier);
    if (state?.phase !== "blocked" || state.deliveryMode !== "autonomous")
      throw new Error("Retry requires an existing blocked autonomous task");
    const phase = state.blockedFromPhase;
    if (phase === null) throw new Error("Blocked task has no continuation");
    const issue = await input.linear.refreshIssue(state.issue.identifier);
    if (issue === null)
      throw new AutonomousBlocker("Autonomous issue disappeared");
    const blocker = autonomyIssueBlocker(issue);
    if (blocker !== null) throw new AutonomousBlocker(blocker);
    if (!(await autonomyEnabled(issue, input.paths)))
      throw new AutonomousBlocker("Autonomous delivery flag is disabled");
    if (
      [
        "publishing",
        "awaiting_ci",
        "awaiting_approval",
        "merging",
        "completing",
      ].includes(phase)
    )
      await input.checkScope(state);
    const now = currentTimestamp();
    await input.store.save({
      ...state,
      issue,
      nextAttemptAt: now,
      updatedAt: now,
    });
    writeInfo(
      `${state.issue.identifier}: retry queued from ${phase}; repairs ${String(state.repairTurnsUsed)}/${String(MAX_REPAIR_TURNS)}`,
    );
    return true;
  });
  if (queued === undefined)
    throw new Error(
      "Another reconciler owns the local lock; retry was not queued",
    );
}
