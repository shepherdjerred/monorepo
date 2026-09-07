import { z } from "zod";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  AccountIdSchema,
  PlayerIdSchema,
} from "@scout-for-lol/domain/identity/database-ids.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";

/**
 * Row codec for MatchTrackedAccount.
 *
 * The association is FK-by-value: `playerId`/`accountId` are snapshots of the
 * registration at observation time and stay NULL for a tracked puuid that was
 * not registered. `cursorAdvancedAt` records when this match advanced the
 * account's processing cursor — NULL until it has.
 */

export type MatchTrackedAccountRecord = z.infer<
  typeof MatchTrackedAccountRecordSchema
>;
export const MatchTrackedAccountRecordSchema = z.strictObject({
  matchId: RiotMatchIdSchema,
  puuid: LeaguePuuidSchema,
  playerId: PlayerIdSchema.nullable(),
  accountId: AccountIdSchema.nullable(),
  cursorAdvancedAt: IsoInstantSchema.nullable(),
});

/** Column shape of a MatchTrackedAccount row, minus DB-managed columns. */
export type MatchTrackedAccountRow = {
  riotMatchId: string;
  puuid: z.infer<typeof LeaguePuuidSchema>;
  playerId: z.infer<typeof PlayerIdSchema> | null;
  accountId: z.infer<typeof AccountIdSchema> | null;
  cursorAdvancedAt: Date | null;
};

const RawTrackedAccountRowSchema = z.object({
  riotMatchId: z.string(),
  puuid: z.string(),
  playerId: z.number().int().nullable(),
  accountId: z.number().int().nullable(),
  cursorAdvancedAt: z.date().nullable(),
});

export function matchTrackedAccountRowToRecord(
  row: unknown,
): MatchTrackedAccountRecord {
  const raw = RawTrackedAccountRowSchema.parse(row);
  return MatchTrackedAccountRecordSchema.parse({
    matchId: raw.riotMatchId,
    puuid: raw.puuid,
    playerId: raw.playerId,
    accountId: raw.accountId,
    cursorAdvancedAt: raw.cursorAdvancedAt?.toISOString() ?? null,
  });
}

export function matchTrackedAccountRecordToRow(
  record: MatchTrackedAccountRecord,
): MatchTrackedAccountRow {
  return {
    riotMatchId: record.matchId,
    puuid: record.puuid,
    playerId: record.playerId,
    accountId: record.accountId,
    cursorAdvancedAt:
      record.cursorAdvancedAt === null
        ? null
        : new Date(record.cursorAdvancedAt),
  };
}
