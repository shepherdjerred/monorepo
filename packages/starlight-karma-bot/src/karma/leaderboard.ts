/** Leaderboard rendering with real pagination.
 *
 *  Replaces the character-budget truncation from the Prisma migration: the
 *  full board already rendered at ~71% of Discord's 2000-character limit, and
 *  long usernames would have pushed it over. */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  MessageFlags,
  userMention,
} from "discord.js";
import client from "#src/discord/client.ts";
import { getLeaderboard } from "#src/karma/queries.ts";
import {
  type LeaderboardKind,
  LEADERBOARD_KINDS,
} from "#src/karma/leaderboard-kinds.ts";
import {
  decodeLeaderboardButtonId,
  encodeLeaderboardButtonId,
} from "#src/karma/rules.ts";
import {
  formatLeaderboardLine,
  LEADERBOARD_PERIODS,
  type LeaderboardPeriod,
  paginate,
  type RankedEntry,
} from "#src/karma/scoring.ts";

const PERIOD_LABEL: Record<LeaderboardPeriod, string> = {
  all: "all time",
  year: "this year",
  month: "this month",
};

function parseKind(value: string): LeaderboardKind {
  return LEADERBOARD_KINDS.find((kind) => kind === value) ?? "received";
}

function parsePeriod(value: string): LeaderboardPeriod {
  return LEADERBOARD_PERIODS.find((period) => period === value) ?? "all";
}

async function displayNameFor(
  entry: RankedEntry,
  viewerId: string,
): Promise<string> {
  if (entry.id === viewerId) {
    return userMention(viewerId);
  }
  const user = await client.users.fetch(entry.id, { cache: true });
  return user.username;
}

/** Render one page plus the viewer's own standing.
 *  The standing footer is why a 45-entry board stays useful to an individual:
 *  without it, anyone outside the top 15 has to page to find themselves. */
async function render(params: {
  guildId: string;
  viewerId: string;
  kind: LeaderboardKind;
  period: LeaderboardPeriod;
  page: number;
}): Promise<{
  content: string;
  components: ActionRowBuilder<ButtonBuilder>[];
}> {
  const ranked = await getLeaderboard({
    guildId: params.guildId,
    kind: params.kind,
    period: params.period,
  });

  if (ranked.length === 0) {
    return {
      content: `No karma ${params.kind} ${PERIOD_LABEL[params.period]} yet.`,
      components: [],
    };
  }

  const { items, page, totalPages } = paginate(ranked, params.page);
  const lines = await Promise.all(
    items.map(async (entry) =>
      formatLeaderboardLine(
        entry,
        await displayNameFor(entry, params.viewerId),
      ),
    ),
  );

  const heading =
    params.kind === "received"
      ? `Karma Leaderboard (${PERIOD_LABEL[params.period]})`
      : `Most Generous (${PERIOD_LABEL[params.period]})`;

  const own = ranked.find((entry) => entry.id === params.viewerId);
  const standing =
    own === undefined
      ? "\nYou're not on this board yet."
      : `\nYou are #${own.rank.toString()} with ${own.karmaReceived.toString()} karma.`;

  const footer =
    totalPages > 1
      ? `\nPage ${(page + 1).toString()}/${totalPages.toString()}`
      : "";

  const components =
    totalPages > 1
      ? [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(
                encodeLeaderboardButtonId({
                  kind: params.kind,
                  period: params.period,
                  page: page - 1,
                }),
              )
              .setLabel("Previous")
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(page === 0),
            new ButtonBuilder()
              .setCustomId(
                encodeLeaderboardButtonId({
                  kind: params.kind,
                  period: params.period,
                  page: page + 1,
                }),
              )
              .setLabel("Next")
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(page >= totalPages - 1),
          ),
        ]
      : [];

  return {
    content: `${heading}:\n${lines.join("\n")}${standing}${footer}`,
    components,
  };
}

export async function handleKarmaLeaderboard(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (interaction.guildId === null) {
    await interaction.editReply({
      content: "Karma leaderboard can only be viewed in a server, not in DMs.",
    });
    return;
  }

  const kind = parseKind(interaction.options.getString("type") ?? "received");
  const period = parsePeriod(interaction.options.getString("period") ?? "all");

  const view = await render({
    guildId: interaction.guildId,
    viewerId: interaction.user.id,
    kind,
    period,
    page: 0,
  });
  await interaction.editReply(view);
}

/** Handle a pagination button. Returns false when the button is not ours. */
export async function handleLeaderboardButton(
  interaction: ButtonInteraction,
): Promise<boolean> {
  const target = decodeLeaderboardButtonId(interaction.customId);
  if (target === null) {
    return false;
  }
  if (interaction.guildId === null) {
    return true;
  }

  await interaction.deferUpdate();
  const view = await render({
    guildId: interaction.guildId,
    viewerId: interaction.user.id,
    kind: parseKind(target.kind),
    period: parsePeriod(target.period),
    page: target.page,
  });
  await interaction.editReply(view);
  return true;
}
