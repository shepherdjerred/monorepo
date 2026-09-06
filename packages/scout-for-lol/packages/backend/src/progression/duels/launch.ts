import type { ScoutStage } from "@scout-for-lol/temporal";
import { currentScoutTemporalSupervisor } from "#src/temporal/runtime.ts";
import {
  signalScoutDuelSeriesChanged,
  startScoutDuelSeries,
} from "#src/temporal/starts.ts";

export async function launchDuelSeries(options: {
  readonly stage: ScoutStage;
  readonly seriesId: string;
  readonly deadlineAt: Date;
}): Promise<void> {
  const supervisor = currentScoutTemporalSupervisor();
  if (supervisor === undefined) {
    throw new Error("Temporal is unavailable for duel coordination");
  }
  await startScoutDuelSeries(supervisor.client(), {
    stage: options.stage,
    seriesId: options.seriesId,
    deadlineAt: options.deadlineAt.toISOString(),
  });
}

export async function signalDuelSeries(options: {
  readonly stage: ScoutStage;
  readonly seriesId: string;
  readonly deadlineAt: Date;
  readonly requestId: string;
}): Promise<void> {
  const supervisor = currentScoutTemporalSupervisor();
  if (supervisor === undefined) {
    throw new Error("Temporal is unavailable for duel coordination");
  }
  await signalScoutDuelSeriesChanged(supervisor.client(), {
    stage: options.stage,
    seriesId: options.seriesId,
    deadlineAt: options.deadlineAt.toISOString(),
    requestId: options.requestId,
  });
}
