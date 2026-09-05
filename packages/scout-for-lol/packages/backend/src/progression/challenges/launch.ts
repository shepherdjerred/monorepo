import type { ScoutStage } from "@scout-for-lol/temporal";
import { currentScoutTemporalSupervisor } from "#src/temporal/runtime.ts";
import { startScoutChallengeRunRecompute } from "#src/temporal/starts.ts";

export async function launchChallengeRunRecompute(options: {
  readonly stage: ScoutStage;
  readonly runId: string;
  readonly revision: number;
}): Promise<void> {
  const supervisor = currentScoutTemporalSupervisor();
  if (supervisor === undefined) {
    throw new Error("Temporal is unavailable for challenge recomputation");
  }
  await startScoutChallengeRunRecompute(supervisor.client(), {
    stage: options.stage,
    runId: options.runId,
    revision: options.revision,
    pagesProcessed: 0,
  });
}
