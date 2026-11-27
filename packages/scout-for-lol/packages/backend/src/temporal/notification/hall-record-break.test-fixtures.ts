import {
  COMPETITIVE_PROGRESSION_CATALOG,
  HallRecordHolderSchema,
} from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { DiscordGuildIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import {
  HallBreakPayloadSchema,
  LegacyHallBreakPayloadSchema,
  type HallBreakPayload,
  type LegacyHallBreakPayload,
} from "#src/progression/hall/break-payload.ts";

/** Shared literals for the Hall record-break announcement suites. */

export const hallGuildId = DiscordGuildIdSchema.parse("100000000000000001");
export const hallRiotMatchId = RiotMatchIdSchema.parse("NA1_9301");

const holder = HallRecordHolderSchema.parse({
  playerId: 1,
  playerAlias: "Alice *the* Great",
  accountId: 11,
  accountAlias: "Main",
  puuid:
    "hall-fixture-puuid-a0000000000000000000000000000000000000000000000000000000000",
});
const tiedHolder = HallRecordHolderSchema.parse({
  playerId: 2,
  playerAlias: "Bob_",
  accountId: 12,
  accountAlias: "Smurf",
  puuid:
    "hall-fixture-puuid-b0000000000000000000000000000000000000000000000000000000000",
});

/**
 * Legacy records in the catalog's first queue family, with tied holders on the
 * final score to exercise the list formatting.
 */
function legacyHallBreakRecords(
  count = 2,
  matchId = hallRiotMatchId,
): LegacyHallBreakPayload[] {
  const queueFamily = COMPETITIVE_PROGRESSION_CATALOG.hall.queueFamilies[0];
  if (queueFamily === undefined) {
    throw new Error("The Hall catalog requires a queue family");
  }
  return COMPETITIVE_PROGRESSION_CATALOG.hall.records
    .slice(0, count)
    .map((record, index) =>
      LegacyHallBreakPayloadSchema.parse({
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

export function legacyHallAnnouncementEnvelope(count?: number) {
  return {
    kind: "scout-hall-record-break-announcement",
    version: 1,
    data: {
      guildId: hallGuildId,
      riotMatchId: hallRiotMatchId,
      records: legacyHallBreakRecords(count),
    },
  };
}

export function hallBreakRecords(
  count?: number,
  matchId = hallRiotMatchId,
): HallBreakPayload[] {
  return legacyHallBreakRecords(count, matchId).map((record) => {
    const previous = { value: record.value - 25, holders: [tiedHolder] };
    return HallBreakPayloadSchema.parse({
      ...record,
      previous,
      standings: [
        { value: record.value, holders: record.holders },
        previous,
        { value: record.value - 50, holders: [holder] },
      ],
    });
  });
}
