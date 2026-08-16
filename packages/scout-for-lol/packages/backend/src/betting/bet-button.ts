import {
  BucksPoolRosterSchema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type BucksPoolParticipant,
} from "@scout-for-lol/data";
import { parseBucksCustomId } from "#src/betting/custom-id.ts";
import { placeBet, type PlaceBetResult } from "#src/betting/place-bet.ts";
import { cancelBet } from "#src/betting/cancel-bet.ts";
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
export type BetButtonInteraction = {
  customId: string;
  guildId: string | null;
  user: { id: string };
  deferReply: (options: { ephemeral: true }) => Promise<unknown>;
  editReply: (options: { content: string }) => Promise<unknown>;
};

/** Turn a refusal into something a person can act on. Every branch is ordinary
 * user input at a system boundary, so none of them are errors. */
export function describeResult(
  result: PlaceBetResult,
  subjectAlias: string,
  betOnWin: boolean,
): string {
  switch (result.kind) {
    case "placed": {
      const side = betOnWin ? "WINS" : "LOSES";
      return `✅ Bet placed: **${subjectAlias} ${side}** for **${result.totalStake.toString()} BB** total. Balance: **${result.balanceAfter.toString()} BB**.`;
    }
    case "window_closed":
      return "⏰ Betting has closed for this game.";
    case "no_pool":
      return "🚫 There's no Bryan Bucks market for this game.";
    case "not_eligible":
      return "🔒 Only tracked players can bet. Ask an admin to link your Discord account to a player in the dashboard.";
    case "unknown_subject":
      return `🤔 That player isn't in this game. Try: ${result.validAliases.join(", ")}.`;
    case "invalid_stake":
      return `💱 Stakes must be between ${result.min.toString()} and ${result.max.toString()} BB.`;
    case "insufficient":
      return `💸 You have **${result.balance.toString()} BB** but need **${result.needed.toString()} BB**.`;
    case "side_conflict":
      return "↔️ You already backed the other side of this game. Cancel your bet first.";
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
      content: "🤔 That player isn't in this game any more.",
    });
    return;
  }

  const alias = subject.trackedAlias ?? "that player";

  if (parsed.action === "x") {
    const cancelled = await cancelBet(
      { matchId: parsed.matchId, serverId, discordId },
      prismaClient,
    );
    await interaction.editReply({
      content: cancelled.cancelled
        ? `↩️ Bet cancelled. **${cancelled.refunded.toString()} BB** returned; balance **${cancelled.balanceAfter.toString()} BB**.`
        : "🤷 You don't have a bet to cancel on this game.",
    });
    return;
  }

  const betOnWin = parsed.side === "W";
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
    content: describeResult(result, alias, betOnWin),
  });
}
