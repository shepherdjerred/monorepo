import { COMPETITIVE_PROGRESSION_CATALOG } from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { DiscordGuildIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import {
  HallBreakPayloadSchema,
  type HallBreakPayload,
} from "#src/progression/hall/break-payload.ts";

/** Shared literals for the Hall record-break announcement suites. */

export const hallGuildId = DiscordGuildIdSchema.parse("100000000000000001");
export const hallRiotMatchId = RiotMatchIdSchema.parse("NA1_9301");

/**
 * Broken records as the evaluator writes them to the intent: one per record
 * in the catalog's first queue family, with a tie on the last one so the
 * holders list is exercised beyond a single name.
 */
export function hallBreakRecords(
  count = 2,
  matchId = hallRiotMatchId,
): HallBreakPayload[] {
  const queueFamily = COMPETITIVE_PROGRESSION_CATALOG.hall.queueFamilies[0];
  if (queueFamily === undefined) {
    throw new Error("The Hall catalog requires a queue family");
  }
  const holder = {
    playerId: 1,
    playerAlias: "Alice *the* Great",
    accountId: 11,
    accountAlias: "Main",
    puuid: "hall-fixture-puuid-a",
  };
  const tiedHolder = {
    playerId: 2,
    playerAlias: "Bob_",
    accountId: 12,
    accountAlias: "Smurf",
    puuid: "hall-fixture-puuid-b",
  };
  return COMPETITIVE_PROGRESSION_CATALOG.hall.records
    .slice(0, count)
    .map((record, index) =>
      HallBreakPayloadSchema.parse({
        matchId,
        gameEndAt: "2026-09-04T00:00:00.000Z",
        value: 12_345 + index,
        holder,
        queueFamilyId: queueFamily.id,
        recordId: record.id,
        holders: index === count - 1 ? [holder, tiedHolder] : [holder],
      }),
    );
}
