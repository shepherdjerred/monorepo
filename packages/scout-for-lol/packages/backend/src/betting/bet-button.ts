import {
  BucksPoolRosterSchema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type BucksPoolParticipant,
} from "@scout-for-lol/data";
import type { InteractionEditReplyOptions } from "discord.js";
import { parseBucksCustomId } from "#src/betting/custom-id.ts";
import { placeBet, type PlaceBetResult } from "#src/betting/place-bet.ts";
import { cancelBet, type CancelBetResult } from "#src/betting/cancel-bet.ts";
import { refreshBucksMessages } from "#src/betting/message-refresh.ts";
import { outcomeLabel, teamIdForSubjectOutcome } from "#src/betting/team.ts";
import { bettingAnchor, subjectFraming } from "#src/betting/components.ts";
import {
  BUCKS_GUILD_ONLY,
  BUCKS_HOUSE_CANNOT_FUND,
  BUCKS_INVALID_STAKE,
  BUCKS_NOT_ELIGIBLE,
  BUCKS_NOT_ENABLED,
  BUCKS_NO_OUTCOME_MARKET,
  BUCKS_STORAGE_LIMIT,
  bucksInsufficient,
} from "#src/betting/copy.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { formatInteger } from "#src/betting/display-format.ts";

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
  sideLabel: string,
): string {
  switch (result.kind) {
    case "placed": {
      // "Only matched BB are at risk" is the one rule that survives on a
      // confirmation: without it the number above reads as a guaranteed loss
      // amount, which is not what was submitted. Everything else is in
      // `/bb rules`.
      return `✅ **${sideLabel}** — offered up to **${formatInteger(result.totalStake)} BB** · balance **${formatInteger(result.balanceAfter)} BB**. Only matched BB are at risk; the rest is refunded at close.`;
    }
    case "window_closed":
      return "⏰ Betting has closed for this game.";
    case "no_pool":
      return BUCKS_NO_OUTCOME_MARKET;
    case "feature_disabled":
      return BUCKS_NOT_ENABLED;
    case "not_eligible":
      return BUCKS_NOT_ELIGIBLE;
    case "unknown_subject":
      return `🤔 That player isn't in this game. Try: ${result.validAliases.join(", ")}.`;
    case "invalid_stake":
      return BUCKS_INVALID_STAKE;
    case "storage_limit":
      return BUCKS_STORAGE_LIMIT;
    case "insufficient":
      return bucksInsufficient(result.balance, result.needed);
    case "house_insufficient":
      return BUCKS_HOUSE_CANNOT_FUND;
    case "side_conflict":
      return "↔️ You already backed the other side. Cancel that bet first.";
  }
}

/** Same framing as `describeResult`, for the cancel half of the button row.
 * A closed window is reported as itself: telling someone with a live stake that
 * they have no bet is both wrong and alarming. */
export function describeCancel(result: CancelBetResult): string {
  switch (result.kind) {
    case "cancelled":
      return `↩️ Cancelled: **${formatInteger(result.stake)} BB** − **${formatInteger(result.houseCut)} BB** fee = **${formatInteger(result.refunded)} BB** back · balance **${formatInteger(result.balanceAfter)} BB**.`;
    case "window_closed":
      return "⏰ Betting is closed — your bet is locked in. Final amounts are on the game message.";
    case "already_resolved":
      return result.poolState === "settled"
        ? "✅ Already settled — check `/bb balance`."
        : "🚫 Voided — everything was refunded.";
    case "no_bet":
      return "🤷 You don't have a bet to cancel on this game.";
    case "no_pool":
      return BUCKS_NO_OUTCOME_MARKET;
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
      content: BUCKS_GUILD_ONLY,
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
      content: BUCKS_NO_OUTCOME_MARKET,
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
  const anchor = bettingAnchor(roster);
  const sideLabel = outcomeLabel(
    selectedTeamId,
    anchor === undefined ? undefined : subjectFraming(anchor),
  );
  const result = await placeBet(
    {
      matchId: parsed.matchId,
      serverId,
      discordId,
      subjectPuuid: subject.puuid,
      subjectWins: betOnWin,
      stake: parsed.amount,
      surface: "button",
    },
    prismaClient,
  );

  await interaction.editReply({
    content: describeResult(result, sideLabel),
  });

  if (result.kind === "placed") {
    await dependencies.refreshMessages(
      { matchId: parsed.matchId, serverId },
      prismaClient,
    );
  }
}
