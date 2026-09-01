import { LeaguePuuidSchema, type DiscordGuildId } from "@scout-for-lol/data";
import {
  WeeklyParlaySubjectsSchema,
  type WeeklyParlaySubject,
} from "#src/betting/weekly-parlay-criteria.ts";
import { findTrackedPlayersWithAccounts } from "#src/betting/tracked-players.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

export async function loadWeeklyParlaySubjects(
  serverId: DiscordGuildId,
  prismaClient: ExtendedPrismaClient,
): Promise<WeeklyParlaySubject[]> {
  const players = await findTrackedPlayersWithAccounts(serverId, prismaClient);
  return players.flatMap((player) => {
    if (player.discordId === null) {
      return [];
    }
    return [
      WeeklyParlaySubjectsSchema.element.parse({
        // Candidate subjects are evaluated one at a time in V1. Keep the
        // schema-valid market key as a placeholder; history is keyed by the
        // immutable player ID until a subject is selected.
        key: "P1",
        playerId: player.id,
        alias: player.alias,
        discordId: player.discordId,
        accounts: player.accounts.map((account) => ({
          puuid: LeaguePuuidSchema.parse(account.puuid),
          trackingStartedAt: account.createdTime.toISOString(),
        })),
      }),
    ];
  });
}
