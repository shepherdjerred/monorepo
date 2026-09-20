import type { ClosedPool } from "#src/betting/settlement/sweep-types.ts";
import type { SettlementSummary } from "#src/betting/settlement/settlement-types.ts";
import type { ParlaySettlementSummary } from "#src/betting/parlays/runtime/parlay-settlement-types.ts";
import type { EarnedAward } from "#src/betting/accounts/earnings.ts";
import type { DareSettlementSummary } from "#src/betting/dares/settlement/dare-settlement-types.ts";
import type { SettlementAnnouncementItem } from "#src/database/durable/settlement-announcement-repository.ts";

/**
 * The instructions a settlement's OUTPUT implies, folded the way the old
 * post-hoc loop folded them.
 *
 * Test support, and its location says so. Production no longer folds: each
 * producing transaction writes its own instruction, so nothing here has a
 * caller that ships. What it still buys is the equivalence proof — that what
 * a recovery announces is what the original settlement would have announced
 * — and that proof is the only thing standing between a recovery and quietly
 * saying something different.
 *
 * Kept here rather than deleted for that reason, and kept OUT of production
 * so its status does not depend on anyone reading a comment: the next
 * dead-code hunt meets a test-support module, not a function with no callers
 * and a note asking to be trusted.
 */
/**
 * The items one settlement produced, each ready to be recorded on its own.
 *
 * One entry per thing that committed separately, because that is the unit the
 * checkpoint has to survive at: a match whose third Dare fails after two
 * settled keeps those two. Earnings are keyed by guild for the same reason the
 * fold filters them by guild — a guild's awards are only that guild's business.
 */
export function settlementAnnouncementItemsOf(input: {
  closures: readonly ClosedPool[];
  settlements: readonly SettlementSummary[];
  parlaySettlements: readonly ParlaySettlementSummary[];
  earnings: readonly EarnedAward[];
  dareSettlements: readonly DareSettlementSummary[];
}): readonly SettlementAnnouncementItem[] {
  const earningsByGuild = new Map<string, EarnedAward[]>();
  for (const award of input.earnings) {
    earningsByGuild.set(award.serverId, [
      ...(earningsByGuild.get(award.serverId) ?? []),
      award,
    ]);
  }
  return [
    ...input.closures.map((closure) => ({
      family: "closure" as const,
      itemKey: closure.serverId,
      payload: closure,
    })),
    ...input.settlements.map((settlement) => ({
      family: "settlement" as const,
      itemKey: settlement.serverId,
      payload: settlement,
    })),
    ...input.parlaySettlements.map((parlay) => ({
      family: "parlay" as const,
      itemKey: parlay.serverId,
      payload: parlay,
    })),
    ...[...earningsByGuild].map(([serverId, awards]) => ({
      family: "earnings" as const,
      itemKey: serverId,
      payload: awards,
    })),
    ...input.dareSettlements.map((dare) => ({
      family: "dare-summary" as const,
      itemKey: String(dare.dareId),
      payload: dare,
    })),
  ];
}
