import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import {
  cancelParlayBet,
  type CancelParlayBetResult,
} from "#src/betting/parlay-cancel-bet.ts";
import { announceParlayPlacement } from "#src/betting/parlay-announce.ts";
import { parseParlayCustomId } from "#src/betting/parlay-custom-id.ts";
import {
  placeParlayBet,
  type PlaceParlayBetResult,
} from "#src/betting/parlay-place-bet.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import type { BetButtonInteraction } from "#src/betting/bet-button.ts";

export function describeParlayResult(result: PlaceParlayBetResult): string {
  switch (result.kind) {
    case "placed":
      return `✅ Parlay **${result.side}** position is now **${result.totalStake.toString()} BB**, paying **${result.grossPayout.toString()} BB** if it wins. Balance: **${result.balanceAfter.toString()} BB**.`;
    case "window_closed":
      return "⏰ Parlay betting has closed for this game.";
    case "no_market":
      return "🚫 There's no parlay market for this game.";
    case "feature_disabled":
      return "🚫 Bryan Bucks is no longer enabled in this server.";
    case "not_eligible":
      return "🔒 Only tracked players can bet.";
    case "invalid_stake":
      return "💱 Stakes must be a positive whole number of BB.";
    case "storage_limit":
      return "💱 That position is too large for the current Bryan Bucks storage format.";
    case "insufficient":
      return `💸 You have **${result.balance.toString()} BB** but need **${result.needed.toString()} BB**.`;
    case "house_insufficient":
      return "🏦 The Bryan Bucks house cannot fully reserve that payout. No Bucks moved.";
    case "side_conflict":
      return `↔️ You already backed ${result.existingSide}. Cancel that position first.`;
  }
}

export function describeParlayCancel(result: CancelParlayBetResult): string {
  switch (result.kind) {
    case "cancelled":
      return `↩️ Parlay cancelled. **${result.refunded.toString()} BB** returned; balance **${result.balanceAfter.toString()} BB**.`;
    case "no_market":
      return "🚫 There's no parlay market for this game.";
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
      content: "🏠 Bryan Bucks only works inside a server.",
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
    return;
  }
  const result = await placeParlayBet(
    {
      matchId: parsed.matchId,
      serverId,
      discordId,
      side: parsed.side,
      stake: parsed.amount,
    },
    prismaClient,
  );
  await interaction.editReply({ content: describeParlayResult(result) });
  if (result.kind === "placed") {
    await announceParlayPlacement(
      {
        matchId: parsed.matchId,
        serverId,
        discordId,
        side: parsed.side,
        stake: parsed.amount,
        totalStake: result.totalStake,
        grossPayout: result.grossPayout,
      },
      prismaClient,
    );
  }
}
