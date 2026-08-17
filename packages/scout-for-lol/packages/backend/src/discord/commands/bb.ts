import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import {
  BucksPoolRosterSchema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/index.ts";
import {
  getBalance,
  getLeaderboard,
  getLedgerPage,
} from "#src/betting/accounts.ts";
import { placeBet } from "#src/betting/place-bet.ts";
import { describeResult } from "#src/betting/bet-button.ts";
import { announceBetPlacement } from "#src/betting/announce.ts";
import { MAX_STAKE, MIN_STAKE } from "#src/betting/constants.ts";
import { getFlag } from "#src/configuration/flags.ts";
import { prisma } from "#src/database/index.ts";
import { replyError } from "#src/discord/commands/define-command.ts";
import { buildBbPrizesEmbed } from "#src/discord/commands/bb-prizes.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("command-bb");

/**
 * `/bb` — the Bryan Bucks surface.
 *
 * `AGENTS.md` says Scout intentionally exposes only seven commands and pushes
 * management to the dashboard. This is a deliberate, narrow exception: the
 * feature is gated to a single guild by `betting_enabled`, and a balance you
 * cannot check from the same place you bet is not usable.
 *
 * That gate is per guild, not per environment, and the one guild it is on for
 * runs the beta bot — so this only ever answers in beta in practice.
 *
 * The command is registered per guild rather than globally
 * (`guildScopedCommandGroups`), so it is invisible everywhere it would not
 * work. The not-enabled-here reply below is therefore a narrow fallback for one
 * real case — the flag being switched off while a previously registered command
 * lingers — rather than the common path.
 *
 * `/bb bet` shares `placeBet` with the prematch buttons, so the two surfaces
 * cannot drift in what they accept or how they explain a refusal.
 */

const LEADERBOARD_SIZE = 10;
const DEFAULT_HISTORY = 10;
const MAX_HISTORY = 25;

const BUCKS_COLOR = 0x2e_cc_71;

export const bbCommand = new SlashCommandBuilder()
  .setName("bb")
  .setDescription("Bryan Bucks — betting, balances, and prizes")
  .addSubcommand((sub) =>
    sub.setName("balance").setDescription("Check your Bryan Bucks balance"),
  )
  .addSubcommand((sub) =>
    sub.setName("prizes").setDescription("See what your Bryan Bucks can buy"),
  )
  .addSubcommand((sub) =>
    sub.setName("leaderboard").setDescription("Who has the most Bryan Bucks"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("history")
      .setDescription("How you earned and spent your Bryan Bucks")
      .addIntegerOption((option) =>
        option
          .setName("count")
          .setDescription(`How many entries (1-${MAX_HISTORY.toString()})`)
          .setMinValue(1)
          .setMaxValue(MAX_HISTORY),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("open").setDescription("Games you can still bet on"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("bet")
      .setDescription("Bet on a tracked player's live game")
      .addStringOption((option) =>
        option
          .setName("player")
          .setDescription("The tracked player to bet on")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("side")
          .setDescription("Whether they win or lose")
          .setRequired(true)
          .addChoices(
            { name: "WIN", value: "win" },
            { name: "LOSE", value: "lose" },
          ),
      )
      .addIntegerOption((option) =>
        option
          .setName("amount")
          .setDescription(
            `How many Bucks (${MIN_STAKE.toString()}-${MAX_STAKE.toString()})`,
          )
          .setRequired(true)
          .setMinValue(MIN_STAKE)
          .setMaxValue(MAX_STAKE),
      ),
  );

async function replyBalance(
  interaction: ChatInputCommandInteraction,
  serverId: ReturnType<typeof DiscordGuildIdSchema.parse>,
  discordId: ReturnType<typeof DiscordAccountIdSchema.parse>,
): Promise<void> {
  const balance = await getBalance({ serverId, discordId });
  if (balance === undefined) {
    await interaction.editReply({
      content:
        "You don't have a Bryan Bucks wallet yet — place your first bet on a live game and you'll be given a starting balance.",
    });
    return;
  }

  const openBets = await prisma.bucksBet.findMany({
    where: {
      bucksAccount: { serverId, discordId },
      betOutcome: "pending",
    },
    select: { stake: true },
  });
  const staked = openBets.reduce((total, bet) => total + bet.stake, 0);

  await interaction.editReply({
    content:
      `You have **${balance.toString()} BB**` +
      (openBets.length > 0
        ? ` with **${staked.toString()} BB** riding on ${openBets.length.toString()} open bet(s).`
        : "."),
  });
}

async function replyLeaderboard(
  interaction: ChatInputCommandInteraction,
  serverId: ReturnType<typeof DiscordGuildIdSchema.parse>,
): Promise<void> {
  const rows = await getLeaderboard({ serverId, limit: LEADERBOARD_SIZE });
  if (rows.length === 0) {
    await interaction.editReply({
      content: "Nobody has any Bryan Bucks yet.",
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("💰 Bryan Bucks")
    .setColor(BUCKS_COLOR)
    .setDescription(
      rows
        .map(
          (row, index) =>
            `**${(index + 1).toString()}.** <@${row.discordId}> — ${row.balance.toString()} BB`,
        )
        .join("\n"),
    );

  await interaction.editReply({
    embeds: [embed],
    // A leaderboard should not ping the top ten people every time it is run.
    allowedMentions: { parse: [] },
  });
}

async function replyPrizes(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.editReply({ embeds: [buildBbPrizesEmbed()] });
}

async function replyHistory(
  interaction: ChatInputCommandInteraction,
  serverId: ReturnType<typeof DiscordGuildIdSchema.parse>,
  discordId: ReturnType<typeof DiscordAccountIdSchema.parse>,
): Promise<void> {
  const limit = interaction.options.getInteger("count") ?? DEFAULT_HISTORY;
  const entries = await getLedgerPage({ serverId, discordId, limit });

  if (entries.length === 0) {
    await interaction.editReply({ content: "No Bryan Bucks history yet." });
    return;
  }

  const lines = entries.map((entry) => {
    const sign = entry.delta > 0 ? "+" : "";
    const where = entry.matchId === null ? "" : ` · ${entry.matchId}`;
    return `\`${sign}${entry.delta.toString()}\` ${entry.kind}${where} → ${entry.balanceAfter.toString()} BB`;
  });

  await interaction.editReply({ content: lines.join("\n") });
}

async function replyOpen(
  interaction: ChatInputCommandInteraction,
  serverId: ReturnType<typeof DiscordGuildIdSchema.parse>,
): Promise<void> {
  const pools = await prisma.bucksMatchPool.findMany({
    where: { serverId, poolState: "open", closesAt: { gt: new Date() } },
    select: { matchId: true, closesAt: true, roster: true },
    orderBy: { closesAt: "asc" },
  });

  if (pools.length === 0) {
    await interaction.editReply({
      content: "No games are open for betting right now.",
    });
    return;
  }

  const lines = pools.map((pool) => {
    const roster = BucksPoolRosterSchema.parse(
      JSON.parse(pool.roster),
    ).participants;
    const aliases = roster
      .map((participant) => participant.trackedAlias)
      .filter((alias) => alias !== undefined);
    const closesAtUnix = Math.floor(pool.closesAt.getTime() / 1000);
    return `**${aliases.join(", ")}** — closes <t:${closesAtUnix.toString()}:R>`;
  });

  await interaction.editReply({ content: lines.join("\n") });
}

async function replyBet(
  interaction: ChatInputCommandInteraction,
  serverId: ReturnType<typeof DiscordGuildIdSchema.parse>,
  discordId: ReturnType<typeof DiscordAccountIdSchema.parse>,
): Promise<void> {
  const requestedAlias = interaction.options.getString("player", true);
  const betOnWin = interaction.options.getString("side", true) === "win";
  const stake = interaction.options.getInteger("amount", true);

  // Free text rather than autocomplete: matching an alias against the open
  // pools is a lookup the user can see the result of, and autocomplete would
  // need a whole extra interaction-routing branch for v1.
  const pools = await prisma.bucksMatchPool.findMany({
    where: { serverId, poolState: "open", closesAt: { gt: new Date() } },
    select: { matchId: true, roster: true },
  });

  for (const pool of pools) {
    const roster = BucksPoolRosterSchema.parse(
      JSON.parse(pool.roster),
    ).participants;
    const subject = roster.find(
      (participant) =>
        participant.trackedAlias?.toLowerCase() ===
        requestedAlias.toLowerCase(),
    );
    if (subject?.puuid == null) {
      continue;
    }

    const result = await placeBet({
      matchId: pool.matchId,
      serverId,
      discordId,
      subjectPuuid: subject.puuid,
      subjectWins: betOnWin,
      stake,
    });
    await interaction.editReply({
      content: describeResult(
        result,
        subject.trackedAlias ?? requestedAlias,
        betOnWin,
      ),
    });
    if (result.kind === "placed") {
      await announceBetPlacement({
        matchId: pool.matchId,
        serverId,
        discordId,
        subjectAlias: subject.trackedAlias ?? requestedAlias,
        subjectWins: betOnWin,
        stake,
        totalStake: result.totalStake,
      });
    }
    return;
  }

  const available = pools
    .flatMap(
      (pool) =>
        BucksPoolRosterSchema.parse(JSON.parse(pool.roster)).participants,
    )
    .map((participant) => participant.trackedAlias)
    .filter((alias) => alias !== undefined);

  await interaction.editReply({
    content:
      available.length === 0
        ? "No games are open for betting right now."
        : `No open game for **${requestedAlias}**. Try: ${available.join(", ")}.`,
  });
}

export async function executeBb(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  try {
    if (interaction.guildId === null) {
      await interaction.reply({
        content: "Bryan Bucks only works inside a server.",
        ephemeral: true,
      });
      return;
    }

    const serverId = DiscordGuildIdSchema.parse(interaction.guildId);
    if (!getFlag("betting_enabled", { server: serverId })) {
      // Reachable only if the flag was turned off after registration, since
      // the command is not registered anywhere the flag is off.
      await interaction.reply({
        content: "Bryan Bucks isn't enabled in this server.",
        ephemeral: true,
      });
      return;
    }

    // The leaderboard and prize catalog are public; everything else is personal.
    const ephemeral = subcommand !== "leaderboard" && subcommand !== "prizes";
    await interaction.deferReply({ ephemeral });

    const discordId = DiscordAccountIdSchema.parse(interaction.user.id);

    switch (subcommand) {
      case "balance":
        await replyBalance(interaction, serverId, discordId);
        break;
      case "leaderboard":
        await replyLeaderboard(interaction, serverId);
        break;
      case "prizes":
        await replyPrizes(interaction);
        break;
      case "history":
        await replyHistory(interaction, serverId, discordId);
        break;
      case "open":
        await replyOpen(interaction, serverId);
        break;
      case "bet":
        await replyBet(interaction, serverId, discordId);
        break;
      default:
        await interaction.editReply({
          content: "Unknown subcommand. Try `/bb balance`.",
        });
        break;
    }
  } catch (error) {
    logger.error(`❌ /bb ${subcommand} failed:`, error);
    await replyError(interaction, `/bb ${subcommand}`, error);
  }
}
