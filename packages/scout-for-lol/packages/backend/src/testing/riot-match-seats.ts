import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { LeaguePuuidSchema } from "@scout-for-lol/data";
import { RawMatchSchema, type RawMatch } from "@scout-for-lol/data";
import type { z } from "zod";

export type TestSeat = {
  readonly participantId: number;
  readonly teamId: number;
  readonly championId: number;
  readonly puuid: z.input<typeof LeaguePuuidSchema>;
};

/**
 * The Riot rift fixture re-seated: its first participants replaced by `seats`
 * and its identity moved to `matchId`. Only what a seat mapping reads is
 * rewritten; the rest stays a valid Match-V5 payload.
 */
export async function riotMatchWithSeats(
  matchId: RiotMatchId,
  seats: readonly TestSeat[],
): Promise<RawMatch> {
  const fixture = RawMatchSchema.parse(
    await Bun.file("../../testdata/rift.json").json(),
  );
  const template = fixture.info.participants[0];
  if (template === undefined)
    throw new Error("Rift fixture has no participant");
  const separator = matchId.indexOf("_");
  return {
    ...fixture,
    metadata: {
      ...fixture.metadata,
      matchId,
      participants: seats.map((seat) => seat.puuid),
    },
    info: {
      ...fixture.info,
      platformId: matchId.slice(0, separator),
      gameId: Number(matchId.slice(separator + 1)),
      participants: seats.map((seat) => ({ ...template, ...seat })),
    },
  };
}
