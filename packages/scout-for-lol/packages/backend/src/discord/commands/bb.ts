import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/index.ts";
import {
  getLedgerPage,
  getOpenMarketAggregates,
  getPersonalBucksView,
  type PersonalBucksView,
} from "#src/betting/accounts.ts";
import { placeBet } from "#src/betting/place-bet.ts";
import { describeResult } from "#src/betting/bet-button.ts";
import { refreshBucksMessages } from "#src/betting/message-refresh.ts";
import { MIN_STAKE } from "#src/betting/constants.ts";
import { HOUSE_CUT_TERMS } from "#src/betting/house-cut.ts";
import { renderBucksHistory } from "#src/betting/navigation.ts";
import {
  BucksTeamChoiceSchema,
  subjectWinsForTeam,
  teamIdForChoice,
  teamName,
} from "#src/betting/team.ts";
import { announceParlayPlacement } from "#src/betting/parlay-announce.ts";
import { ParlaySubjectsSchema } from "#src/betting/parlay-criteria.ts";
import { describeParlayResult } from "#src/betting/parlay-bet-button.ts";
import { placeParlayBet } from "#src/betting/parlay-place-bet.ts";
import { selectParlayMarketForAlias } from "#src/betting/parlay-market-selection.ts";
import { getFlag } from "#src/configuration/flags.ts";
import { prisma } from "#src/database/index.ts";
import { replyError } from "#src/discord/commands/define-command.ts";
import { buildBbPrizesEmbed } from "#src/discord/commands/bb-prizes.ts";
import {
  buildOpenMarketSections,
  buildUnknownGameReplyChunks,
  parseBettingRoster,
  resolveOpenGameByAlias,
  trackedGameAliases,
} from "#src/discord/commands/bb-market.ts";
import { buildBbRulesEmbed as createBbRulesEmbed } from "#src/discord/commands/bb-rules.ts";
import {
  splitMessageIntoChunks,
  truncateEmbedFieldValue,
} from "#src/discord/utils/message.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("command-bb");

export function buildBbRulesEmbed(): EmbedBuilder {
  return createBbRulesEmbed();
}

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
      .setDescription("Offer up to an amount; only matched Bucks are at risk")
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
          .setDescription("How many whole Bryan Bucks")
          .setRequired(true)
          .setMinValue(MIN_STAKE),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("parlay")
      .setDescription("Bet YES or NO on a tracked player's live parlay")
      .addStringOption((option) =>
        option
          .setName("player")
          .setDescription("A tracked player in the parlay")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("side")
          .setDescription("Whether every parlay leg will hit")
          .setRequired(true)
          .addChoices(
            { name: "YES", value: "YES" },
            { name: "NO", value: "NO" },
          ),
      )
      .addIntegerOption((option) =>
        option
          .setName("amount")
          .setDescription("How many whole Bryan Bucks")
          .setRequired(true)
          .setMinValue(MIN_STAKE),
      ),
  );

export function buildPersonalBucksEmbed(
  view: PersonalBucksView,
  now: number = Date.now(),
): EmbedBuilder {
  const positions = view.pendingPositions.map((position) => {
    const timing =
      position.poolState === "open" && position.closesAt.getTime() > now
        ? `closes <t:${Math.floor(position.closesAt.getTime() / 1000).toString()}:R>`
        : "locked";
    if (position.marketType === "outcome") {
      const amount =
        position.matchedStake === null
          ? `offered up to ${position.offeredStake.toString()} BB · match pending`
          : `matched ${position.matchedStake.toString()} BB · refunded ${(position.unmatchedStake ?? 0).toString()} BB`;
      return `• **${teamName(position.teamId)}** — game: \`${position.gameAlias}\` · ${amount} · ${timing}`;
    }
    return `• **${position.subjectAlias} ${position.side}** — ${position.stake.toString()} BB · ${timing}`;
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
        name: "Reserved / at risk",
        value: `**${view.totalAtRisk.toString()} BB**`,
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

async function editReplyInChunks(
  interaction: ChatInputCommandInteraction,
  chunks: readonly string[],
): Promise<void> {
  const first = chunks[0];
  if (first === undefined) {
    throw new Error("Bryan Bucks reply produced no Discord content");
  }
  await interaction.editReply({ content: first });
  for (const chunk of chunks.slice(1)) {
    await interaction.followUp({ content: chunk, ephemeral: true });
  }
}

async function replyOpen(
  interaction: ChatInputCommandInteraction,
  serverId: ReturnType<typeof DiscordGuildIdSchema.parse>,
): Promise<void> {
  const pools = await getOpenMarketAggregates({ serverId });
  const parlays = await prisma.bucksParlayMarket.findMany({
    where: { serverId, marketState: "open", closesAt: { gt: new Date() } },
    select: {
      matchId: true,
      closesAt: true,
      definition: { select: { subjects: true } },
    },
    orderBy: { closesAt: "asc" },
  });

  if (pools.length === 0 && parlays.length === 0) {
    await interaction.editReply({
      content: `No games are open for betting right now.\n\n${HOUSE_CUT_TERMS}`,
    });
    return;
  }

  const sections = buildOpenMarketSections(pools);
  for (const parlay of parlays) {
    const aliases = ParlaySubjectsSchema.parse(
      JSON.parse(parlay.definition.subjects),
    ).map((subject) => subject.alias);
    const closesAtUnix = Math.floor(parlay.closesAt.getTime() / 1000);
    sections.push(
      [
        `## Parlay · ${aliases.join(", ")}`,
        `Match: \`${parlay.matchId}\``,
        `Closes <t:${closesAtUnix.toString()}:R>`,
      ].join("\n"),
    );
  }
  await editReplyInChunks(
    interaction,
    splitMessageIntoChunks(`${sections.join("\n\n")}\n\n${HOUSE_CUT_TERMS}`),
  );
}

async function replyParlay(
  interaction: ChatInputCommandInteraction,
  serverId: ReturnType<typeof DiscordGuildIdSchema.parse>,
  discordId: ReturnType<typeof DiscordAccountIdSchema.parse>,
): Promise<void> {
  const requestedAlias = interaction.options.getString("player", true);
  const side = interaction.options.getString("side", true);
  const stake = interaction.options.getInteger("amount", true);
  const markets = await prisma.bucksParlayMarket.findMany({
    where: { serverId, marketState: "open", closesAt: { gt: new Date() } },
    select: {
      matchId: true,
      definition: { select: { subjects: true } },
    },
  });
  const selection = selectParlayMarketForAlias(markets, requestedAlias);
  if (selection.kind === "ambiguous") {
    await interaction.editReply({
      content:
        `Multiple open parlays include **${requestedAlias}** (matches: ${selection.matchIds.map((matchId) => `\`${matchId}\``).join(", ")}). ` +
        "Use the buttons on the desired parlay message.",
    });
    return;
  }
  if (selection.kind === "not_found") {
    await interaction.editReply({
      content:
        selection.availableAliases.length === 0
          ? "No parlays are open right now."
          : `No open parlay for **${requestedAlias}**. Try: ${selection.availableAliases.join(", ")}.`,
    });
    return;
  }

  const parsedSide = side === "YES" ? "YES" : "NO";
  const result = await placeParlayBet({
    matchId: selection.market.matchId,
    serverId,
    discordId,
    side: parsedSide,
    stake,
  });
  await interaction.editReply({ content: describeParlayResult(result) });
  if (result.kind === "placed") {
    await announceParlayPlacement({
      matchId: selection.market.matchId,
      serverId,
      discordId,
      side: parsedSide,
      stake,
      totalStake: result.totalStake,
      grossPayout: result.grossPayout,
    });
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
      await refreshBucksMessages({ matchId: game.matchId, serverId });
    }
    return;
  }

  const available = pools.flatMap((pool) =>
    trackedGameAliases(parseBettingRoster(pool.roster)),
  );

  if (available.length === 0) {
    await interaction.editReply({
      content: "No games are open for betting right now.",
    });
    return;
  }

  await editReplyInChunks(
    interaction,
    buildUnknownGameReplyChunks(requestedAlias, available),
  );
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
      case "parlay":
        await replyParlay(interaction, serverId, discordId);
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
