import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/domain/identity/discord.ts";
import type { settleAndAwardBucks } from "#src/betting/markets/postmatch-hook.ts";
import {
  canonicalIdentities,
  type SettlementEvidence,
} from "#src/durable/match/receipt-evidence.ts";

/**
 * Translate one match's Bucks settlement result into the durable receipt's
 * evidence.
 *
 * This mapping lives here, not in the application layer, because it reads
 * betting's own result types; the services take evidence already shaped and so
 * stay independent of the feature slices they record.
 *
 * Receipt evidence names durable identities rather than counts, so a reader
 * can go find the bets, Dares and awards the commit moved. No money amount is
 * recorded: these identities locate the ledger rows, and the amounts live
 * there under the storable Bucks brands that bound them to their columns.
 */

type BucksPostmatchResult = Awaited<ReturnType<typeof settleAndAwardBucks>>;

export function settlementEvidenceOf(
  bucks: BucksPostmatchResult,
): SettlementEvidence {
  return {
    closedBetIds: canonicalIdentities(
      bucks.closures.flatMap((pool) =>
        pool.positions.map((position) => position.betId),
      ),
    ),
    settledBetIds: canonicalIdentities(
      bucks.settlements.flatMap((summary) =>
        summary.bets.map((bet) => bet.betId),
      ),
    ),
    resolvedDareIds: canonicalIdentities(
      bucks.dareSettlements.map((summary) => summary.dareId),
    ),
    // A weekly parlay settlement carries no per-bet row id out of the settle
    // call, so the guild whose parlay settled is its durable identity.
    settledParlayGuildIds: canonicalIdentities(
      bucks.parlaySettlements.map((summary) =>
        DiscordGuildIdSchema.parse(summary.serverId),
      ),
    ),
    earnedDiscordIds: canonicalIdentities(
      bucks.earnings.map((award) =>
        DiscordAccountIdSchema.parse(award.discordId),
      ),
    ),
  };
}
