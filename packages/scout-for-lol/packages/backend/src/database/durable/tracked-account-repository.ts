import type { ExtendedPrismaClient } from "#src/database/index.ts";
import type {
  IsoInstant,
  RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { LeaguePuuid } from "@scout-for-lol/domain/identity/league-account.ts";
import {
  matchTrackedAccountRecordToRow,
  matchTrackedAccountRowToRecord,
  type MatchTrackedAccountRecord,
} from "#src/database/durable/tracked-account-row.ts";
import { dateFromIsoInstant } from "#src/database/durable/row-values.ts";

/**
 * Repository for MatchTrackedAccount.
 *
 * Recording the association is idempotent on the (match, puuid) primary key;
 * marking the cursor advanced is a one-way guarded update so exactly one
 * worker advances a given account's cursor off a given match.
 */

type TrackedAccountDb = Pick<ExtendedPrismaClient, "matchTrackedAccount">;

/** How many of the given associations were newly recorded (rest existed). */
export type RecordTrackedAccountsResult = {
  recorded: number;
  existing: number;
};

export async function recordTrackedAccounts(
  db: TrackedAccountDb,
  records: MatchTrackedAccountRecord[],
): Promise<RecordTrackedAccountsResult> {
  const rows = records.map((record) => matchTrackedAccountRecordToRow(record));
  const created = await db.matchTrackedAccount.createMany({
    data: rows,
    skipDuplicates: true,
  });
  return { recorded: created.count, existing: rows.length - created.count };
}

export async function listTrackedAccounts(
  db: TrackedAccountDb,
  args: { matchId: RiotMatchId },
): Promise<MatchTrackedAccountRecord[]> {
  const rows = await db.matchTrackedAccount.findMany({
    where: { riotMatchId: args.matchId },
    orderBy: { puuid: "asc" },
  });
  return rows.map((row) => matchTrackedAccountRowToRecord(row));
}

export type MarkCursorAdvancedResult =
  { outcome: "applied" } | { outcome: "already-applied" };

/**
 * Mark that this match advanced the account's processing cursor. One-way:
 * the first writer applies, every retry is `already-applied`. Marking an
 * association that was never recorded is a broken caller contract and throws.
 */
export async function markTrackedAccountCursorAdvanced(
  db: TrackedAccountDb,
  args: { matchId: RiotMatchId; puuid: LeaguePuuid; advancedAt: IsoInstant },
): Promise<MarkCursorAdvancedResult> {
  const advanced = await db.matchTrackedAccount.updateMany({
    where: {
      riotMatchId: args.matchId,
      puuid: args.puuid,
      cursorAdvancedAt: null,
    },
    data: { cursorAdvancedAt: dateFromIsoInstant(args.advancedAt) },
  });
  if (advanced.count === 1) {
    return { outcome: "applied" };
  }
  const existing = await db.matchTrackedAccount.findUnique({
    where: {
      riotMatchId_puuid: { riotMatchId: args.matchId, puuid: args.puuid },
    },
  });
  if (existing === null) {
    throw new Error(
      `Cannot advance the cursor for ${args.puuid} on ${args.matchId}: the association was never recorded`,
    );
  }
  return { outcome: "already-applied" };
}
