import type { FleetEnvironment } from "./ports.ts";
import type { PrIdentity, PrState, WorktreeContext } from "./schemas.ts";
import {
  currentCommandCorrelation,
  withCommandCorrelation,
} from "./command-correlation.ts";

export function withTickCommandCorrelation<T>(
  tickId: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const parent = currentCommandCorrelation();
  return withCommandCorrelation(
    tickId === undefined ? parent : { ...parent, tickId },
    run,
  );
}

export function withPrCommandCorrelation<T>(
  identity: PrIdentity,
  run: () => Promise<T>,
): Promise<T> {
  return withCommandCorrelation(
    {
      ...currentCommandCorrelation(),
      prNumber: identity.number,
      headSha: identity.headSha,
    },
    run,
  );
}

export async function assignFleetWorktree(
  environment: FleetEnvironment,
  states: Iterable<PrState>,
  candidate: PrState,
): Promise<{ worktree: string; context: WorktreeContext }> {
  return withPrCommandCorrelation(candidate.identity, async () => {
    const siblingBranches = [...states]
      .filter((pr) => pr.stackId === candidate.stackId)
      .map((pr) => pr.identity.headRefName);
    const worktree =
      (await environment.findWorktree(
        siblingBranches,
        candidate.identity.headRefName,
        !candidate.identity.crossRepository,
      )) ??
      (await environment.provisionWorktree(
        candidate.identity,
        candidate.stackId,
      ));
    const context = await environment.assignWorktreeBranch(
      worktree,
      candidate.identity,
    );
    return { worktree, context };
  });
}
