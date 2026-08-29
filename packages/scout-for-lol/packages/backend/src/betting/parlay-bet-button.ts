import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  formatInteger,
} from "@scout-for-lol/data";
import {
  cancelParlayBet,
  type CancelParlayBetResult,
} from "#src/betting/parlay-cancel-bet.ts";
import { refreshParlayMessages } from "#src/betting/parlay-refresh.ts";
import { parseParlayCustomId } from "#src/betting/parlay-custom-id.ts";
import {
  placeParlayBet,
  type PlaceParlayBetResult,
} from "#src/betting/parlay-place-bet.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import type { BetButtonInteraction } from "#src/betting/bet-button.ts";
import {
  BUCKS_GUILD_ONLY,
  BUCKS_HOUSE_CANNOT_FUND,
  BUCKS_INVALID_STAKE,
  BUCKS_NOT_ELIGIBLE,
  BUCKS_NOT_ENABLED,
  BUCKS_NO_PARLAY_MARKET,
  BUCKS_STORAGE_LIMIT,
  bucksInsufficient,
} from "#src/betting/copy.ts";

export function describeParlayResult(result: PlaceParlayBetResult): string {
  switch (result.kind) {
    case "placed":
      return `✅ Parlay **${result.side}** position is now **${formatInteger(result.totalStake)} BB**, paying **${formatInteger(result.grossPayout)} BB** if it wins. Balance: **${formatInteger(result.balanceAfter)} BB**.`;
    case "window_closed":
      return "⏰ Parlay betting has closed for this game.";
    case "no_market":
      return BUCKS_NO_PARLAY_MARKET;
    case "feature_disabled":
      return BUCKS_NOT_ENABLED;
    case "not_eligible":
      return BUCKS_NOT_ELIGIBLE;
    case "invalid_stake":
      return BUCKS_INVALID_STAKE;
    case "storage_limit":
      return BUCKS_STORAGE_LIMIT;
    case "insufficient":
      return bucksInsufficient(result.balance, result.needed);
    case "wallet_house_insufficient":
      return BUCKS_HOUSE_CANNOT_FUND;
    case "house_insufficient":
      return "🏦 The Bryan Bucks house can't fully reserve that payout. No Bucks moved.";
    case "side_conflict":
      return `↔️ You already backed ${result.existingSide}. Cancel that position first.`;
  }
}

export function describeParlayCancel(result: CancelParlayBetResult): string {
  switch (result.kind) {
    case "cancelled":
      // Says "no fee" explicitly: the outcome market charges one and this is
      // the only place a parlay bettor learns theirs does not.
      return `↩️ Cancelled: **${formatInteger(result.refunded)} BB** back, no fee · balance **${formatInteger(result.balanceAfter)} BB**.`;
    case "no_market":
      return BUCKS_NO_PARLAY_MARKET;
    case "no_bet":
      return "🤷 You don't have a parlay position to cancel on this game.";
    case "window_closed":
      return "⏰ Parlay betting has closed, so your position is locked in.";
    case "already_resolved":
      return result.marketState === "settled"
        ? "✅ This parlay has already settled."
        : "🚫 This parlay was voided and already refunded.";
  }
}

export async function handleParlayBetButton(
  interaction: BetButtonInteraction,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  const parsed = parseParlayCustomId(interaction.customId);
  if (parsed === undefined) return;
  await interaction.deferReply({ ephemeral: true });
  if (interaction.guildId === null) {
    await interaction.editReply({
      content: BUCKS_GUILD_ONLY,
    });
    return;
  }
  const serverId = DiscordGuildIdSchema.parse(interaction.guildId);
  const discordId = DiscordAccountIdSchema.parse(interaction.user.id);
  if (parsed.action === "x") {
    const result = await cancelParlayBet(
      { matchId: parsed.matchId, serverId, discordId },
      prismaClient,
    );
    await interaction.editReply({ content: describeParlayCancel(result) });
    // Newly required: the market message now carries a live position digest,
    // so a cancellation that did not refresh would leave a stale one.
    if (result.kind === "cancelled") {
      await refreshParlayMessages(
        { matchId: parsed.matchId, serverId },
        prismaClient,
      );
    }
    return;
  }
  const result = await placeParlayBet(
    {
      matchId: parsed.matchId,
      serverId,
      discordId,
      side: parsed.side,
      stake: parsed.amount,
      surface: "button",
    },
    prismaClient,
  );
  await interaction.editReply({ content: describeParlayResult(result) });
  if (result.kind === "placed") {
    await refreshParlayMessages(
      { matchId: parsed.matchId, serverId },
      prismaClient,
    );
  }
}
