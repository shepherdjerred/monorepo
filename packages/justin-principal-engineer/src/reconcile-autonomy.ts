import { MAX_REPAIR_TURNS, AutonomousBlocker } from "#src/domain/autonomy.ts";
import type { TaskState } from "#src/domain/schemas.ts";
import type { LinearClient } from "#src/integrations/linear.ts";
import type { StateStore } from "#src/runtime/state-store.ts";
import { currentTimestamp } from "#src/runtime/time.ts";
import { WorkspaceVerificationFailure } from "#src/host/docker.ts";

export async function handleAutonomousFailure(input: {
  initial: TaskState;
  latest: TaskState;
  error: unknown;
  store: StateStore;
  linear: LinearClient;
  save: (
    state: TaskState,
    phase: TaskState["phase"],
    patch?: Partial<TaskState>,
  ) => Promise<TaskState>;
}): Promise<void> {
  const { initial, latest, error } = input;
  const codingStarted =
    latest.implementationStarted &&
    (!initial.implementationStarted ||
      latest.repairTurnsUsed > initial.repairTurnsUsed);
  const repairable =
    codingStarted &&
    latest.phase === "implementing" &&
    latest.repairTurnsUsed < MAX_REPAIR_TURNS &&
    !(error instanceof AutonomousBlocker);
  const reason = error instanceof Error ? error.message : String(error);
  if (repairable || error instanceof WorkspaceVerificationFailure) {
    await input.save(latest, "implementing", {
      pendingDiagnostics:
        latest.pendingDiagnostics === null
          ? reason
          : `${latest.pendingDiagnostics}\n\nPrevious repair turn failed: ${reason}`,
      pendingHealth: latest.pendingHealth,
    });
    return;
  }
  await blockAutonomousTask({
    state: latest,
    reason,
    retryable:
      error instanceof AutonomousBlocker ? error.retryable : !codingStarted,
    linear: input.linear,
    store: input.store,
  });
}

const RETRY_MINUTES = [5, 15, 60] as const;

export async function blockAutonomousTask(input: {
  state: TaskState;
  reason: string;
  retryable?: boolean;
  linear: LinearClient;
  store: StateStore;
}): Promise<void> {
  const attempts = input.state.blockedAttempts + 1;
  const delay = RETRY_MINUTES[Math.min(attempts - 1, RETRY_MINUTES.length - 1)];
  if (delay === undefined) throw new Error("Autonomous retry table is empty");
  const retryAt =
    input.retryable === true
      ? new Date(Date.now() + delay * 60_000).toISOString()
      : null;
  const next: TaskState = {
    ...input.state,
    phase: "blocked",
    blockedReason: input.reason,
    blockedFromPhase: input.state.blockedFromPhase ?? input.state.phase,
    blockedAttempts: attempts,
    nextAttemptAt: retryAt,
    updatedAt: currentTimestamp(),
  };
  await input.store.save(next);
  await input.linear.blocked(input.state.issue, input.reason, retryAt, {
    comment: input.state.blockedReason !== input.reason,
  });
  console.error(
    `${input.state.issue.identifier}: blocked: ${input.reason}${retryAt === null ? "" : `; retry ${retryAt}`}`,
  );
}

export function assertRepairBudget(state: TaskState): void {
  if (
    state.deliveryMode === "autonomous" &&
    state.implementationStarted &&
    state.repairTurnsUsed >= MAX_REPAIR_TURNS
  )
    throw new AutonomousBlocker(
      `Autonomous repair budget exhausted after ${String(MAX_REPAIR_TURNS)} follow-up turns`,
    );
}

export function codingTurnStarted(state: TaskState): TaskState {
  assertRepairBudget(state);
  return {
    ...state,
    implementationStarted: true,
    repairTurnsUsed:
      state.repairTurnsUsed + (state.implementationStarted ? 1 : 0),
    updatedAt: currentTimestamp(),
  };
}

export function formatTaskStatus(state: TaskState): string {
  return `${state.issue.identifier}: ${state.phase} (${state.deliveryMode}, repairs ${String(state.repairTurnsUsed)}/${String(MAX_REPAIR_TURNS)})${state.phase !== "blocked" || state.blockedReason === null ? "" : `; ${state.blockedReason}`}${state.nextAttemptAt === null ? "" : `; retry ${state.nextAttemptAt}`}${state.prUrl === null ? "" : ` ${state.prUrl}`}`;
}
