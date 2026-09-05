import type { HallBaselineRequest } from "#src/progression/hall/settings.ts";
import { currentScoutTemporalSupervisor } from "#src/temporal/runtime.ts";
import { startScoutHallBaseline } from "#src/temporal/starts.ts";
import type { ScoutStage } from "@scout-for-lol/temporal";

export async function launchHallBaseline(
  stage: ScoutStage,
  request: HallBaselineRequest | null,
): Promise<void> {
  if (request === null) return;
  const supervisor = currentScoutTemporalSupervisor();
  if (supervisor === undefined) {
    throw new Error("Temporal is unavailable for Hall baseline processing");
  }
  await startScoutHallBaseline(supervisor.client(), {
    stage,
    guildId: request.guildId,
    revision: request.revision,
  });
}
