import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import { recordReceipt } from "#src/database/durable/receipt-repository.ts";
import { markTrackedAccountCursorAdvanced } from "#src/database/durable/tracked-account-repository.ts";
import {
  recordDurableWrite,
  resolveDurableIdentity,
  type DurableFacts,
} from "#src/durable/match/durable-facts.ts";
import {
  toIsoInstant,
  toRiotMatchId,
} from "#src/durable/match/match-identity.ts";
import {
  buildMatchReceipt,
  MATCH_RECEIPT_KINDS,
  progressionEvidenceCodec,
} from "#src/durable/match/receipt-evidence.ts";

/**
 * The progression-stage service and the cursor-advance record.
 *
 * Both live here because they are one step in the v1 flow: progression is the
 * last durable hook before a match stops being re-processed, and the cursor
 * advance immediately follows it inside the same advisory lock. Recording the
 * cursor advance next to v1's own `updateLastProcessedMatch` — rather than in
 * its own pass — is what makes the durable row a faithful record of when the
 * match stopped being replayable.
 *
 * v1 advances cursors through the global client rather than the advisory
 * lock's transaction client, so these writes do the same. Moving them into
 * that transaction would change when the cursor write becomes visible, which
 * is a behaviour change this wave must not make.
 */

export async function runMatchProgressionStage<T>(args: {
  facts: DurableFacts;
  /** v1's loose match id; parsed to a RiotMatchId inside the boundary. */
  matchId: string;
  evidence: { participantCount: number; trackedAccountCount: number };
  advance: () => Promise<T>;
}): Promise<T> {
  const advanced = await args.advance();
  const matchId = resolveDurableIdentity(() => toRiotMatchId(args.matchId));
  if (matchId === null) return advanced;

  await recordDurableWrite(args.facts, "receipt-progression", async (db) =>
    recordReceipt(
      db,
      buildMatchReceipt({
        matchId,
        kind: MATCH_RECEIPT_KINDS.progression,
        scope: { kind: "global" },
        recordedAt: toIsoInstant(args.facts.now()),
        evidence: progressionEvidenceCodec.serialize(args.evidence),
      }),
    ),
  );
  return advanced;
}

/**
 * Record that this match advanced one tracked account's processing cursor.
 * The repository guard is monotonic, so a delayed retry can never rewind an
 * advance that already moved past this match.
 */
export async function recordCursorAdvanced(args: {
  facts: DurableFacts;
  matchId: string;
  puuid: string;
}): Promise<void> {
  const matchId = resolveDurableIdentity(() => toRiotMatchId(args.matchId));
  if (matchId === null) return;

  await recordDurableWrite(args.facts, "cursor-advanced", async (db) =>
    markTrackedAccountCursorAdvanced(db, {
      matchId,
      puuid: LeaguePuuidSchema.parse(args.puuid),
      advancedAt: toIsoInstant(args.facts.now()),
    }),
  );
}
