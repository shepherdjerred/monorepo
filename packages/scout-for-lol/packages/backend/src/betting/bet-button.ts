import {
  BucksPoolRosterSchema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type BucksPoolParticipant,
  type RiotTeamId,
} from "@scout-for-lol/data";
import type { InteractionEditReplyOptions } from "discord.js";
import { parseBucksCustomId } from "#src/betting/custom-id.ts";
import { HOUSE_CUT_TERMS } from "#src/betting/house-cut.ts";
import { placeBet, type PlaceBetResult } from "#src/betting/place-bet.ts";
import { cancelBet, type CancelBetResult } from "#src/betting/cancel-bet.ts";
import { refreshBucksMessages } from "#src/betting/message-refresh.ts";
import { teamIdForSubjectOutcome, teamName } from "#src/betting/team.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-bet-button");

/**
 * The prematch button handler.
 *
 * Deliberately structural rather than typed against `ButtonInteraction`:
 * discord.js's real object satisfies this shape, so the dispatcher passes it
 * with no cast, and a test can pass a plain object with mock functions. That
 * avoids `castMock` in `discord-mocks.ts`, which is an `as` escape hatch.
 */
export type BucksButtonEditReplyOptions = {
  content: string;
  components?: NonNullable<InteractionEditReplyOptions["components"]>;
};

export type BetButtonInteraction = {
  customId: string;
  guildId: string | null;
  user: { id: string };
  deferReply: (options: { ephemeral: true }) => Promise<unknown>;
  editReply: (options: BucksButtonEditReplyOptions) => Promise<unknown>;
};

export type BetButtonDependencies = {
  refreshMessages: typeof refreshBucksMessages;
};

const defaultDependencies: BetButtonDependencies = {
  refreshMessages: refreshBucksMessages,
};

/** Turn a refusal into something a person can act on. Every branch is ordinary
 * user input at a system boundary, so none of them are errors. */
export function describeResult(
  result: PlaceBetResult,
  selectedTeamId: RiotTeamId,
): string {
  switch (result.kind) {
    case "placed": {
      return `✅ Offer placed: **${teamName(selectedTeamId)} wins** for up to **${result.totalStake.toString()} BB**. The final matched amount will be announced at close. Available balance: **${result.balanceAfter.toString()} BB**. ${HOUSE_CUT_TERMS}`;
    }
    case "window_closed":
      return "⏰ Betting has closed for this game.";
    case "no_pool":
      return "🚫 There's no Bryan Bucks market for this game.";
    case "feature_disabled":
      return "🚫 Bryan Bucks is no longer enabled in this server.";
    case "not_eligible":
      return "🔒 Only tracked players can bet. Ask an admin to link your Discord account to a player in the dashboard.";
    case "unknown_subject":
      return `🤔 That player isn't in this game. Try: ${result.validAliases.join(", ")}.`;
    case "invalid_stake":
      return "💱 Offers must be a positive whole number of BB.";
    case "storage_limit":
      return "💱 That position is too large for the current Bryan Bucks storage format.";
    case "insufficient":
      return `💸 You have **${result.balance.toString()} BB** but need **${result.needed.toString()} BB**.`;
    case "house_insufficient":
      return "🏦 The Bryan Bucks house cannot fund a new wallet right now. No Bucks moved.";
    case "side_conflict":
      return "↔️ You already backed the other side of this game. Cancel your bet first.";
  }
}

/** Same framing as `describeResult`, for the cancel half of the button row.
 * A closed window is reported as itself: telling someone with a live stake that
 * they have no bet is both wrong and alarming. */
export function describeCancel(result: CancelBetResult): string {
  switch (result.kind) {
    case "cancelled":
      return `↩️ Offer cancelled: offered **${result.stake.toString()} BB** − **${result.houseCut.toString()} BB cancellation fee** = **${result.refunded.toString()} BB returned**; balance **${result.balanceAfter.toString()} BB**.`;
    case "window_closed":
      return "⏰ Betting has closed for this game. Your offer can no longer be cancelled; check the close announcement for your final matched amount and any unmatched refund.";
    case "already_resolved":
      return result.poolState === "settled"
        ? "✅ This game has already settled, so there's nothing left to cancel — check your balance for the payout."
        : "🚫 This game's market was voided, so matched BB were refunded and unmatched BB were already returned.";
    case "no_bet":
      return "🤷 You don't have a bet to cancel on this game.";
    case "no_pool":
      return "🚫 There's no Bryan Bucks market for this game.";
  }
}

function subjectFrom(
  roster: readonly BucksPoolParticipant[],
  index: number,
): BucksPoolParticipant | undefined {
  return roster[index];
}

/**
 * Handle one click.
 *
 * Everything the button says is re-validated against server state before a
 * single Buck moves, so a forged or stale custom ID can at worst produce a bet
 * the sender could have placed legitimately.
 */
export async function handleBetButton(
  interaction: BetButtonInteraction,
  prismaClient: ExtendedPrismaClient = prisma,
  dependencies: BetButtonDependencies = defaultDependencies,
): Promise<void> {
  const parsed = parseBucksCustomId(interaction.customId);
  if (parsed === undefined) {
    // Not ours, or malformed. Silent by design: this is an unauthenticated
    // surface and a stray component is not an error worth reporting.
    logger.debug(`↩️ Ignoring unrecognised custom ID: ${interaction.customId}`);
    return;
  }

  if (interaction.guildId === null) {
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply({
      content: "🏠 Bryan Bucks only works inside a server.",
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const serverId = DiscordGuildIdSchema.parse(interaction.guildId);
  const discordId = DiscordAccountIdSchema.parse(interaction.user.id);

  const pool = await prismaClient.bucksMatchPool.findUnique({
    where: { matchId_serverId: { matchId: parsed.matchId, serverId } },
    select: { roster: true },
  });
  if (pool === null) {
    await interaction.editReply({
      content: "🚫 There's no Bryan Bucks market for this game.",
    });
    return;
  }

  const roster = BucksPoolRosterSchema.parse(
    JSON.parse(pool.roster),
  ).participants;
  const subject = subjectFrom(roster, parsed.subjectIndex);
  if (subject?.puuid == null) {
    await interaction.editReply({
      content: "🤔 That game's betting anchor isn't available any more.",
    });
    return;
  }

  if (parsed.action === "x") {
    const cancelled = await cancelBet(
      { matchId: parsed.matchId, serverId, discordId },
      prismaClient,
    );
    await interaction.editReply({ content: describeCancel(cancelled) });
    if (cancelled.kind === "cancelled") {
      await dependencies.refreshMessages(
        { matchId: parsed.matchId, serverId },
        prismaClient,
      );
    }
    return;
  }

  const betOnWin = parsed.side === "W";
  const selectedTeamId = teamIdForSubjectOutcome(subject.teamId, betOnWin);
  const result = await placeBet(
    {
      matchId: parsed.matchId,
      serverId,
      discordId,
      subjectPuuid: subject.puuid,
      subjectWins: betOnWin,
      stake: parsed.amount,
    },
    prismaClient,
  );

  await interaction.editReply({
    content: describeResult(result, selectedTeamId),
  });

  if (result.kind === "placed") {
    await dependencies.refreshMessages(
      { matchId: parsed.matchId, serverId },
      prismaClient,
    );
  }
}
