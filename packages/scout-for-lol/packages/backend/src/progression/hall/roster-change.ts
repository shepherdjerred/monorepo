import type { ScoutStage } from "@scout-for-lol/temporal";
import type { Db } from "#src/database/index.ts";
import { requestConfiguredFullHallBaseline } from "#src/progression/hall/settings.ts";

/**
 * Persists a silent full re-baseline after tracked roster/account membership
 * changes in the same transaction as the roster mutation. The progression
 * reconciler owns the Temporal start, so Worker availability is not part of
 * the mutation transaction.
 */
export async function queueHallRosterRebaseline(options: {
  readonly guildId: string;
  readonly actorDiscordId: string;
  readonly stage: ScoutStage;
  readonly db: Db;
}): Promise<void> {
  await requestConfiguredFullHallBaseline(options.db, {
    guildId: options.guildId,
    actorDiscordId: options.actorDiscordId,
    stage: options.stage,
    reuseActive: false,
  });
}
