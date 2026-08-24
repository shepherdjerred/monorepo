import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import {
  cancelWeeklyParlayBet,
  placeWeeklyParlayBet,
  type CancelWeeklyParlayBetResult,
  type PlaceWeeklyParlayBetResult,
} from "#src/betting/weekly-parlay-bet.ts";
import { parseWeeklyParlayCustomId } from "#src/betting/weekly-parlay-custom-id.ts";
import { refreshWeeklyParlayMessage } from "#src/betting/weekly-parlay-refresh.ts";
import type { BetButtonInteraction } from "#src/betting/bet-button.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";

export function describeWeeklyParlayBet(
  result: PlaceWeeklyParlayBetResult,
): string {
  switch (result.kind) {
    case "placed":
      return `✅ Weekly **${result.side}** position: **${result.totalStake.toString()} BB**, paying **${result.grossPayout.toString()} BB** if it wins. Balance: **${result.balanceAfter.toString()} BB**.`;
    case "window_closed":
      return "⏰ Weekly parlay betting has closed.";
    case "no_market":
      return "No matching weekly parlay exists.";
    case "feature_disabled":
      return "Weekly parlays are not accepting new positions.";
    case "not_eligible":
      return "Link a tracked player before betting Bryan Bucks.";
    case "invalid_stake":
      return "Use a positive whole-BB stake.";
    case "storage_limit":
      return "That position exceeds Bryan Bucks storage limits.";
    case "insufficient":
      return `You have ${result.balance.toString()} BB but need ${result.needed.toString()} BB.`;
    case "wallet_house_insufficient":
    case "house_insufficient":
      return "🏦 The Bryan Bucks house cannot reserve that payout. No Bucks moved.";
    case "side_conflict":
      return `You already backed ${result.existingSide}. Cancel from this message first.`;
  }
}

function describeCancel(result: CancelWeeklyParlayBetResult): string {
  switch (result.kind) {
    case "cancelled":
      return `↩️ Cancelled: **${result.refunded.toString()} BB** back, no fee · balance **${result.balanceAfter.toString()} BB**.`;
    case "no_market":
      return "No matching weekly parlay exists.";
    case "no_bet":
      return "You do not have a position on this weekly parlay.";
    case "window_closed":
      return "⏰ Betting has closed, so the position is locked.";
    case "already_resolved":
      return result.marketState === "settled"
        ? "This weekly parlay already settled."
        : "This weekly parlay was already refunded.";
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
      content: "Bryan Bucks only works in a server.",
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
