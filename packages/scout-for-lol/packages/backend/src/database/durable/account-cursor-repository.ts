import type { MatchId } from "@scout-for-lol/data";
import type { LeaguePuuid } from "@scout-for-lol/domain/identity/league-account.ts";
import type { Db } from "#src/database/index.ts";

/**
 * The authoritative post-match cursor on `Account`, advanced monotonically.
 *
 * `updateLastProcessedMatch` writes the cursor unconditionally, and under v1
 * that is safe: one process-local poller walks a pass's matches in completion
 * order, so the last write is always the newest match. V2 removes that
 * guarantee. Each match is its own Workflow execution, and a Temporal retry of
 * an OLDER match's cursor Activity can be scheduled after a NEWER match has
 * already advanced the same account — at which point an unconditional write
 * rewinds the cursor.
 *
 * A rewind is not a cosmetic drift. `lastMatchTime` is what
 * `calculatePollingInterval` schedules from and what `recoveryStartAt` uses as
 * the gap-recovery window's start, so moving it backwards re-opens matches the
 * pipeline already processed — re-ingesting them and re-announcing them to
 * users.
 *
 * The guard is therefore on the ORDERING column rather than on the match id:
 * the update applies only when the stored instant is absent or strictly
 * earlier. A cursor that already sits past this match answers
 * `already-applied` and NOT `conflict`, because a newer cursor is not two
 * producers disagreeing — it is progress, and this match's work is genuinely
 * already accounted for.
 *
 * This mirrors `markTrackedAccountCursorAdvanced`, which guards the per-match
 * association the same way. The two are complementary, not redundant: that one
 * records that a given match reached the cursor stage, while this one protects
 * the single cursor every match shares.
 */
export type AdvanceAccountCursorResult =
  { outcome: "applied" } | { outcome: "already-applied" };

export async function advanceAccountCursor(
  db: Db,
  args: { puuid: LeaguePuuid; matchId: MatchId; matchTime: Date },
): Promise<AdvanceAccountCursorResult> {
  // `updateMany` by puuid alone, exactly as the v1 write does: one PUUID can
  // be registered in several guilds and each has its own row, and all of them
  // track the same Riot account's history.
  const advanced = await db.account.updateMany({
    where: {
      puuid: args.puuid,
      OR: [{ lastMatchTime: null }, { lastMatchTime: { lt: args.matchTime } }],
    },
    data: {
      lastProcessedMatchId: args.matchId,
      lastMatchTime: args.matchTime,
    },
  });
  return advanced.count > 0
    ? { outcome: "applied" }
    : { outcome: "already-applied" };
}
