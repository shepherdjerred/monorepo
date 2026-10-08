import type { Db } from "#src/database/index.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import {
  AccountIdSchema,
  PlayerIdSchema,
} from "@scout-for-lol/domain/identity/database-ids.ts";
import type { MatchTrackedAccountRecord } from "#src/database/durable/tracked-account-row.ts";

/**
 * Snapshot the registration behind each tracked PUUID.
 *
 * A PUUID can be registered in several guilds, so it has several `Account`
 * rows, while the association's grain is one row per (match, PUUID). The
 * lowest account id is the deterministic representative of that PUUID's
 * registration; a PUUID with no row at all stays NULL, which is exactly what
 * the column means.
 */
async function registrationsByPuuid(
  db: Db,
  puuids: readonly string[],
): Promise<Map<string, { accountId: number; playerId: number }>> {
  const accounts = await db.account.findMany({
    where: { puuid: { in: [...puuids] } },
    select: { id: true, playerId: true, puuid: true },
    orderBy: { id: "asc" },
  });
  const byPuuid = new Map<string, { accountId: number; playerId: number }>();
  for (const account of accounts) {
    if (byPuuid.has(account.puuid)) continue;
    byPuuid.set(account.puuid, {
      accountId: account.id,
      playerId: account.playerId,
    });
  }
  return byPuuid;
}

/**
 * The association rows for one match's tracked PUUIDs, with each PUUID's
 * registration snapshotted at observation time.
 *
 * The one column that carries history is `accountId`: NULL says the PUUID was
 * never registered when the match was observed, while a non-NULL id says it
 * was.
 */
export async function trackedAccountRecords(
  db: Db,
  matchId: RiotMatchId,
  puuids: readonly string[],
): Promise<MatchTrackedAccountRecord[]> {
  const registrations = await registrationsByPuuid(db, puuids);
  return puuids.map((puuid) => {
    const registration = registrations.get(puuid);
    return {
      matchId,
      puuid: LeaguePuuidSchema.parse(puuid),
      playerId:
        registration === undefined
          ? null
          : PlayerIdSchema.parse(registration.playerId),
      accountId:
        registration === undefined
          ? null
          : AccountIdSchema.parse(registration.accountId),
      cursorAdvancedAt: null,
    };
  });
}
