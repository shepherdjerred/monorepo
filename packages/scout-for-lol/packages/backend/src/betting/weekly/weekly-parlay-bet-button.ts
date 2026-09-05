import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  formatInteger,
} from "@scout-for-lol/data";
import {
  cancelWeeklyParlayBet,
  placeWeeklyParlayBet,
  type CancelWeeklyParlayBetResult,
  type PlaceWeeklyParlayBetResult,
} from "#src/betting/weekly/weekly-parlay-bet.ts";
import { parseWeeklyParlayCustomId } from "#src/betting/weekly/weekly-parlay-custom-id.ts";
import { refreshWeeklyParlayMessage } from "#src/betting/weekly/weekly-parlay-refresh.ts";
import type { BetButtonInteraction } from "#src/betting/markets/bet-button.ts";
import {
  BUCKS_GUILD_ONLY,
  BUCKS_INVALID_STAKE,
  BUCKS_NOT_ELIGIBLE,
  BUCKS_NOT_ENABLED,
  BUCKS_STORAGE_LIMIT,
  bucksInsufficient,
} from "#src/betting/copy.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";

export function describeWeeklyParlayBet(
  result: PlaceWeeklyParlayBetResult,
): string {
  // Shares the match-parlay handler's copy (and the copy.ts constants) with a
  // "Weekly" qualifier where it disambiguates, so the two twins cannot drift.
  switch (result.kind) {
    case "placed":
      return `✅ Weekly parlay **${result.side}** position is now **${formatInteger(result.totalStake)} BB**, paying **${formatInteger(result.grossPayout)} BB** if it wins. Balance: **${formatInteger(result.balanceAfter)} BB**.`;
    case "window_closed":
      return "⏰ Weekly parlay betting has closed.";
    case "no_market":
      return "🚫 There's no open weekly parlay market for this message.";
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
    case "house_insufficient":
      return "🏦 The Bryan Bucks house can't fully reserve that payout. No Bucks moved.";
    case "side_conflict":
      return `↔️ You already backed ${result.existingSide}. Cancel that position first.`;
  }
}

function describeCancel(result: CancelWeeklyParlayBetResult): string {
  switch (result.kind) {
    case "cancelled":
      return `↩️ Cancelled: **${formatInteger(result.refunded)} BB** back, no fee · balance **${formatInteger(result.balanceAfter)} BB**.`;
    case "no_market":
      return "🚫 There's no open weekly parlay market for this message.";
    case "no_bet":
      return "🤷 You don't have a position on this weekly parlay.";
    case "window_closed":
      return "⏰ Weekly parlay betting has closed, so your position is locked in.";
    case "already_resolved":
      return result.marketState === "settled"
        ? "✅ This weekly parlay has already settled."
        : "🚫 This weekly parlay was voided and already refunded.";
  }
}

export async function handleWeeklyParlayBetButton(
  interaction: BetButtonInteraction,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  const parsed = parseWeeklyParlayCustomId(interaction.customId);
  if (parsed === undefined) {
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  if (interaction.guildId === null) {
    await interaction.editReply({
      content: BUCKS_GUILD_ONLY,
    });
    return;
  }
  const common = {
    marketId: parsed.marketId,
    serverId: DiscordGuildIdSchema.parse(interaction.guildId),
    discordId: DiscordAccountIdSchema.parse(interaction.user.id),
    surface: "button" as const,
  };
  if (parsed.action === "x") {
    const result = await cancelWeeklyParlayBet(common, prismaClient);
    await interaction.editReply({ content: describeCancel(result) });
    if (result.kind === "cancelled") {
      await refreshWeeklyParlayMessage(parsed.marketId, prismaClient);
    }
    return;
  }
  const result = await placeWeeklyParlayBet(
    { ...common, side: parsed.side, stake: parsed.amount },
    prismaClient,
  );
  await interaction.editReply({ content: describeWeeklyParlayBet(result) });
  if (result.kind === "placed") {
    await refreshWeeklyParlayMessage(parsed.marketId, prismaClient);
  }
}
