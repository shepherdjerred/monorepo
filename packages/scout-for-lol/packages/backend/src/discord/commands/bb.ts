import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import {
  BucksPoolRosterSchema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type BucksPoolParticipant,
  type LeaguePuuid,
  type RiotTeamId,
} from "@scout-for-lol/data/index.ts";
import {
  getLedgerPage,
  getOpenMarketAggregates,
  getPersonalBucksView,
  type PersonalBucksView,
} from "#src/betting/accounts.ts";
import { placeBet } from "#src/betting/place-bet.ts";
import { describeResult } from "#src/betting/bet-button.ts";
import { announceBetPlacement } from "#src/betting/announce.ts";
import {
  BETTING_WINDOW_MS,
  MAX_STAKE,
  MIN_STAKE,
  SEED_GRANT,
} from "#src/betting/constants.ts";
import { HOUSE_CUT_TERMS } from "#src/betting/house-cut.ts";
import { renderBucksHistory } from "#src/betting/navigation.ts";
import {
  BucksTeamChoiceSchema,
  shortTeamName,
  subjectWinsForTeam,
  teamIdForChoice,
} from "#src/betting/team.ts";
import { getFlag } from "#src/configuration/flags.ts";
import { prisma } from "#src/database/index.ts";
import { replyError } from "#src/discord/commands/define-command.ts";
import { buildBbPrizesEmbed } from "#src/discord/commands/bb-prizes.ts";
import {
  splitMessageIntoChunks,
  truncateEmbedFieldValue,
} from "#src/discord/utils/message.ts";
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

const BUCKS_COLOR = 0x2e_cc_71;

export function isPublicBbSubcommand(subcommand: string): boolean {
  return subcommand === "rules" || subcommand === "prizes";
}

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
    sub.setName("rules").setDescription("How Bryan Bucks works"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("history")
      .setDescription("How you earned and spent your Bryan Bucks"),
  )
  .addSubcommand((sub) =>
    sub.setName("open").setDescription("Games you can still bet on"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("bet")
      .setDescription("Bet on Blue or Red; 20% win and cancellation house cuts")
      .addStringOption((option) =>
        option
          .setName("game")
          .setDescription("A tracked player in the game")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("team")
          .setDescription("The team to win")
          .setRequired(true)
          .addChoices(
            { name: "Blue", value: "blue" },
            { name: "Red", value: "red" },
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

export function buildPersonalBucksEmbed(
  view: PersonalBucksView,
  now: number = Date.now(),
): EmbedBuilder {
  const positions = view.pendingPositions.map((position) => {
    const state =
      position.poolState === "open" && position.closesAt.getTime() > now
        ? `closes <t:${Math.floor(position.closesAt.getTime() / 1000).toString()}:R>`
        : "locked";
    return `• **${position.subjectAlias} ${position.side}** — ${position.stake.toString()} BB · ${state}`;
  });
  if (view.pendingPositionCount > view.pendingPositions.length) {
    positions.push(
      `…and ${(view.pendingPositionCount - view.pendingPositions.length).toString()} more pending position(s).`,
    );
  }

  const embed = new EmbedBuilder()
    .setTitle("💰 Your Bryan Bucks")
    .setColor(BUCKS_COLOR)
    .addFields(
      {
        name: "Available",
        value: `**${view.balance.toString()} BB**`,
        inline: true,
      },
      {
        name: "Total staked",
        value: `**${view.totalStaked.toString()} BB**`,
        inline: true,
      },
    );
  if (positions.length > 0) {
    embed.addFields({
      name: "Pending positions",
      value: truncateEmbedFieldValue(positions.join("\n")),
    });
  }

  return embed;
}

type OpenBettingPool = {
  matchId: string;
  roster: string;
};

export type OpenGameAnchor = {
  matchId: string;
  subjectPuuid: LeaguePuuid;
  subjectTeamId: RiotTeamId;
};

function parseRoster(raw: string): BucksPoolParticipant[] {
  return BucksPoolRosterSchema.parse(JSON.parse(raw)).participants;
}

export function trackedGameLabels(
  roster: readonly BucksPoolParticipant[],
): string[] {
  return roster.flatMap((participant) =>
    participant.trackedAlias === undefined || participant.puuid === null
      ? []
      : [
          `game: \`${participant.trackedAlias}\` — ${shortTeamName(participant.teamId)} Team`,
        ],
  );
}

export function trackedGameAliases(
  roster: readonly BucksPoolParticipant[],
): string[] {
  return roster.flatMap((participant) =>
    participant.trackedAlias === undefined || participant.puuid === null
      ? []
      : [participant.trackedAlias],
  );
}

export function resolveOpenGameByAlias(
  pools: readonly OpenBettingPool[],
  requestedAlias: string,
): OpenGameAnchor | undefined {
  const normalizedAlias = requestedAlias.toLowerCase();
  const matches: OpenGameAnchor[] = [];

  for (const pool of pools) {
    const subject = parseRoster(pool.roster).find(
      (participant) =>
        participant.puuid !== null &&
        participant.trackedAlias?.toLowerCase() === normalizedAlias,
    );
    if (subject !== undefined && subject.puuid !== null) {
      matches.push({
        matchId: pool.matchId,
        subjectPuuid: subject.puuid,
        subjectTeamId: subject.teamId,
      });
    }
  }

  if (matches.length > 1) {
    throw new Error(
      `Tracked alias ${requestedAlias} matched ${matches.length.toString()} open Bryan Bucks pools`,
    );
  }
  return matches[0];
}

async function replyBalance(
  interaction: ChatInputCommandInteraction,
  serverId: ReturnType<typeof DiscordGuildIdSchema.parse>,
  discordId: ReturnType<typeof DiscordAccountIdSchema.parse>,
): Promise<void> {
  const view = await getPersonalBucksView({ serverId, discordId });
  if (view === undefined) {
    await interaction.editReply({
      content: `You don't have a Bryan Bucks wallet yet — place your first bet on a live game and you'll be given a starting balance.\n\n${HOUSE_CUT_TERMS}`,
    });
    return;
  }

  await interaction.editReply({
    content: HOUSE_CUT_TERMS,
    embeds: [buildPersonalBucksEmbed(view)],
  });
}

async function replyPrizes(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.editReply({ embeds: [buildBbPrizesEmbed()] });
}

export function buildBbRulesEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("📜 Bryan Bucks rules")
    .setColor(BUCKS_COLOR)
    .setDescription(
      "Bryan Bucks are friendly points for tracked League players. They have no cash value.",
    )
    .addFields(
      {
        name: "Eligibility & earnings",
        value:
          `Your Discord account must be linked to a tracked player. A new wallet starts with **${SEED_GRANT.toString()} BB**. ` +
          "Eligible ranked games award **+1 BB** for playing, **+1 BB** for winning, and **+1 BB** for MVP.",
      },
      {
        name: "Placing a bet",
        value:
          `Stake **${MIN_STAKE.toString()}-${MAX_STAKE.toString()} BB** on the Blue or Red Team in a tracked player's game. ` +
          `The market stays open for ${Math.floor(BETTING_WINDOW_MS / 60_000).toString()} minutes after Scout detects the game. ` +
          "You can add to a position or cancel it before the window closes for a 20% house cut, rounded to the nearest BB; after that, it is locked.",
      },
      {
        name: "Settlement",
        value:
          "Winners get their stakes back and split the losing side's pool in proportion to their stakes. " +
          "The house takes 20% of each human winner's gross payout, rounded to the nearest BB, without cutting into winning principal. " +
          "If people bet on only one side, the Bryan Bucks house matches the other side when its reserve can cover the stake.",
      },
      {
        name: "Refunds",
        value:
          "All stakes are returned with no house cut when a game is voided or remade, cannot be settled, or the house cannot cover a one-sided market.",
      },
    );
}

async function replyRules(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.editReply({ embeds: [buildBbRulesEmbed()] });
}

async function replyHistory(
  interaction: ChatInputCommandInteraction,
  serverId: ReturnType<typeof DiscordGuildIdSchema.parse>,
  discordId: ReturnType<typeof DiscordAccountIdSchema.parse>,
): Promise<void> {
  const page = await getLedgerPage({ serverId, discordId, page: 0 });
  await interaction.editReply(renderBucksHistory(discordId, page));
}

async function replyOpen(
  interaction: ChatInputCommandInteraction,
  serverId: ReturnType<typeof DiscordGuildIdSchema.parse>,
): Promise<void> {
  const pools = await getOpenMarketAggregates({ serverId });

  if (pools.length === 0) {
    await interaction.editReply({
      content: `No games are open for betting right now.\n\n${HOUSE_CUT_TERMS}`,
    });
    return;
  }

  const sections = pools.map((pool) => {
    const closesAtUnix = Math.floor(pool.closesAt.getTime() / 1000);
    const bluePlayers =
      pool.blue.trackedPlayers.length > 0
        ? pool.blue.trackedPlayers.map((alias) => `\`${alias}\``).join(", ")
        : "No tracked players";
    const redPlayers =
      pool.red.trackedPlayers.length > 0
        ? pool.red.trackedPlayers.map((alias) => `\`${alias}\``).join(", ")
        : "No tracked players";
    return [
      `## ${bluePlayers} vs ${redPlayers}`,
      `Closes <t:${closesAtUnix.toString()}:R>`,
      `🔵 **Blue Team:** ${pool.blue.totalStake.toString()} BB across ${pool.blue.betCount.toString()} bet(s) — game: ${bluePlayers}`,
      `🔴 **Red Team:** ${pool.red.totalStake.toString()} BB across ${pool.red.betCount.toString()} bet(s) — game: ${redPlayers}`,
    ].join("\n");
  });
  const chunks = splitMessageIntoChunks(
    `${sections.join("\n\n")}\n\n${HOUSE_CUT_TERMS}`,
  );
  const first = chunks[0];
  if (first === undefined) {
    throw new Error("Open Bryan Bucks markets produced no Discord content");
  }
  await interaction.editReply({ content: first });
  for (const chunk of chunks.slice(1)) {
    await interaction.followUp({ content: chunk, ephemeral: true });
  }
}

async function replyBet(
  interaction: ChatInputCommandInteraction,
  serverId: ReturnType<typeof DiscordGuildIdSchema.parse>,
  discordId: ReturnType<typeof DiscordAccountIdSchema.parse>,
): Promise<void> {
  const requestedAlias = interaction.options.getString("game", true);
  const selectedTeamId = teamIdForChoice(
    BucksTeamChoiceSchema.parse(interaction.options.getString("team", true)),
  );
  const stake = interaction.options.getInteger("amount", true);

  // Free text rather than autocomplete: matching an alias against the open
  // pools is a lookup the user can see the result of, and autocomplete would
  // need a whole extra interaction-routing branch for v1.
  const pools = await prisma.bucksMatchPool.findMany({
    where: { serverId, poolState: "open", closesAt: { gt: new Date() } },
    select: { matchId: true, roster: true },
  });

  const game = resolveOpenGameByAlias(pools, requestedAlias);
  if (game !== undefined) {
    const subjectWins = subjectWinsForTeam(game.subjectTeamId, selectedTeamId);
    const result = await placeBet({
      matchId: game.matchId,
      serverId,
      discordId,
      subjectPuuid: game.subjectPuuid,
      subjectWins,
      stake,
    });
    await interaction.editReply({
      content: describeResult(result, selectedTeamId),
    });
    if (result.kind === "placed") {
      await announceBetPlacement({
        matchId: game.matchId,
        serverId,
        discordId,
        teamId: selectedTeamId,
        stake,
        totalStake: result.totalStake,
      });
    }
    return;
  }

  const available = pools.flatMap((pool) =>
    trackedGameAliases(parseRoster(pool.roster)),
  );

  await interaction.editReply({
    content:
      available.length === 0
        ? "No games are open for betting right now."
        : `No open game for **${requestedAlias}**. Valid game aliases: ${available.map((alias) => `\`${alias}\``).join(", ")}.`,
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

    // Only rules and the prize catalog are public. Wallets, positions, and
    // market inspection stay private to the caller.
    const ephemeral = !isPublicBbSubcommand(subcommand);
    await interaction.deferReply({ ephemeral });

    const discordId = DiscordAccountIdSchema.parse(interaction.user.id);

    switch (subcommand) {
      case "balance":
        await replyBalance(interaction, serverId, discordId);
        break;
      case "prizes":
        await replyPrizes(interaction);
        break;
      case "rules":
        await replyRules(interaction);
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
