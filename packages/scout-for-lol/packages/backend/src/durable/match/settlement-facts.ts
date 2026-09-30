import { recordReceipt } from "#src/database/durable/receipt-repository.ts";
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
  settlementEvidenceCodec,
  type SettlementEvidence,
} from "#src/durable/match/receipt-evidence.ts";

/**
 * The settlement-commit service, which is also the Dare resolution boundary.
 *
 * Both happen in the same v1 call: closing pools, settling markets and
 * parlays, awarding earnings, and resolving Dares all commit together before
 * anything is announced. The receipt therefore covers the whole commit, and
 * its evidence keeps the counts separate — a Dare resolution and a market
 * settlement are different products and must not be collapsed into one number.
 *
 * The receipt is recorded only after the commit returns. A settlement that
 * throws leaves no receipt, which is correct: nothing was committed, and the
 * next pass re-settles.
 */

export async function commitMatchSettlement<T>(args: {
  facts: DurableFacts;
  /** v1's loose match id; parsed to a RiotMatchId inside the boundary. */
  matchId: string;
  settle: () => Promise<T>;
  evidence: (settled: T) => SettlementEvidence;
}): Promise<T> {
  const settled = await args.settle();
  const matchId = resolveDurableIdentity(() => toRiotMatchId(args.matchId));
  if (matchId === null) return settled;

  await recordDurableWrite(args.facts, "receipt-settlement", async (db) =>
    recordReceipt(
      db,
      buildMatchReceipt({
        matchId,
        kind: MATCH_RECEIPT_KINDS.settlement,
        scope: { kind: "global" },
        recordedAt: toIsoInstant(args.facts.now()),
        evidence: settlementEvidenceCodec.serialize(args.evidence(settled)),
      }),
    ),
  );
  return settled;
}
