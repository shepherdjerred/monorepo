import { truncateGraphemes } from "@shepherdjerred/text";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  DiscordjsError,
  DiscordjsErrorCodes,
  EmbedBuilder,
  escapeMarkdown,
  MessageFlags,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type MessageActionRowComponentBuilder,
  type MessageComponentInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { SportsEvent } from "@shepherdjerred/streambot/sports/types.ts";
import { sportsEventTimeLabel } from "@shepherdjerred/streambot/sports/parse-events.ts";

export const SPORTS_PAGE_SIZE = 10;
const MENU_TIMEOUT_MS = 120_000;
const PICK_ID = "sports_pick";
const PREVIOUS_ID = "sports_previous";
const NEXT_ID = "sports_next";
const PROVIDER_NAMES = {
  streameast: "StreamEast",
  tvsportslive: "TVSportsLive",
  lolesports: "LoL Esports",
};

function eventStatus(event: SportsEvent): string {
  if (event.status === "live") return "🔴 **Live**";
  if (event.status === "unknown") return "🟡 **Time unconfirmed**";
  return event.startsAt === null
    ? "🕒 **Later today**"
    : `🕒 **Upcoming** · <t:${String(Math.floor(new Date(event.startsAt).valueOf() / 1000))}:t>`;
}

function listingDescription(
  events: readonly SportsEvent[],
  allowSchedule = false,
): string {
  if (events.length === 0) return "No sports streams are listed for today.";
  if (allowSchedule && events.some((event) => event.provider === "lolesports"))
    return "Choose a live game to play or an upcoming LoL series to schedule once in your current voice channel.";
  return events.every((event) => event.status === "scheduled")
    ? "These games are upcoming. Run `/stream playback sports` again when a game starts to choose a stream."
    : "Choose a live or unconfirmed game to queue in your voice channel.\nUpcoming games are listed for information.";
}

function decorateLolEmbed(embed: EmbedBuilder, events: readonly SportsEvent[]) {
  if (!events.every((event) => event.provider === "lolesports")) return;
  const first = events[0];
  const thumbnail =
    first?.artwork?.league?.logoUrl ?? first?.artwork?.thumbnailUrl;
  if (thumbnail !== undefined) embed.setThumbnail(thumbnail);
  if (events.length === 1 && first?.artwork?.thumbnailUrl !== undefined)
    embed.setImage(first.artwork.thumbnailUrl);
}

export function sportsMenuPage(
  events: readonly SportsEvent[],
  page: number,
  allowSchedule = false,
) {
  const pageCount = Math.max(1, Math.ceil(events.length / SPORTS_PAGE_SIZE));
  if (!Number.isInteger(page) || page < 0 || page >= pageCount) {
    throw new Error("Sports listing page is out of range");
  }
  const start = page * SPORTS_PAGE_SIZE;
  const shown = events.slice(start, start + SPORTS_PAGE_SIZE);
  const embed = new EmbedBuilder()
    .setColor(0x58_65_f2)
    .setTitle(allowSchedule ? "Sports and LoL schedules" : "Sports today")
    .setDescription(listingDescription(events, allowSchedule))
    .setFooter({
      text: `Page ${String(page + 1)} of ${String(pageCount)} · ${String(events.length)} games`,
    });
  if (shown.length > 0) {
    decorateLolEmbed(embed, shown);
    embed.addFields(
      shown.map((event) => ({
        name: truncateGraphemes(escapeMarkdown(event.title), 200),
        value: `${eventStatus(event)} · ${PROVIDER_NAMES[event.provider]}`,
      })),
    );
  }
  const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  const options = shown.flatMap((event, index) =>
    event.status === "scheduled" &&
    !(allowSchedule && event.provider === "lolesports")
      ? []
      : [
          {
            label: truncateGraphemes(event.title, 100),
            description: `${event.status === "scheduled" ? "Schedule · " : ""}${PROVIDER_NAMES[event.provider]} · ${sportsEventTimeLabel(event)}`,
            value: String(start + index),
          },
        ],
  );
  if (options.length > 0) {
    components.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(PICK_ID)
          .setPlaceholder(
            allowSchedule
              ? "Choose a game or schedule a LoL series"
              : "Choose a game to play",
          )
          .addOptions(options),
      ),
    );
  }
  if (pageCount > 1) {
    components.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(PREVIOUS_ID)
          .setLabel("Previous")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === 0),
        new ButtonBuilder()
          .setCustomId(NEXT_ID)
          .setLabel("Next")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === pageCount - 1),
      ),
    );
  }
  return {
    content: "",
    embeds: [embed],
    components,
    allowedMentions: { parse: [] },
  };
}

export function selectedSportsEvent(
  events: readonly SportsEvent[],
  page: number,
  value: string | undefined,
  allowSchedule = false,
): SportsEvent | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const index = Number(value);
  if (index < page * SPORTS_PAGE_SIZE || index >= (page + 1) * SPORTS_PAGE_SIZE)
    return null;
  const event = events[index];
  return event === undefined ||
    (event.status === "scheduled" &&
      !(allowSchedule && event.provider === "lolesports"))
    ? null
    : event;
}

async function nextMenuInteraction(
  message: Awaited<ReturnType<ChatInputCommandInteraction["fetchReply"]>>,
  ownerId: string,
  deadline: number,
): Promise<MessageComponentInteraction | null> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return null;
  try {
    return await message.awaitMessageComponent({
      filter: (i) =>
        i.user.id === ownerId &&
        [PICK_ID, PREVIOUS_ID, NEXT_ID].includes(i.customId),
      time: remaining,
    });
  } catch (error) {
    if (
      error instanceof DiscordjsError &&
      error.code === DiscordjsErrorCodes.InteractionCollectorError
    )
      return null;
    throw error;
  }
}

async function updateSportsPage(
  picked: ButtonInteraction,
  events: readonly SportsEvent[],
  page: number,
  allowSchedule = false,
): Promise<number> {
  const nextPage = page + (picked.customId === NEXT_ID ? 1 : -1);
  if (nextPage < 0 || nextPage >= Math.ceil(events.length / SPORTS_PAGE_SIZE)) {
    await picked.deferUpdate();
    return page;
  }
  await picked.update(sportsMenuPage(events, nextPage, allowSchedule));
  return nextPage;
}

export async function sendSportsMenu(
  interaction: ChatInputCommandInteraction,
  events: readonly SportsEvent[],
  play: (
    picked: StringSelectMenuInteraction,
    event: SportsEvent,
  ) => Promise<string>,
  allowSchedule = false,
): Promise<void> {
  let page = 0;
  const initial = sportsMenuPage(events, page, allowSchedule);
  await interaction.editReply(initial);
  if (initial.components.length === 0) return;
  const message = await interaction.fetchReply();
  const deadline = Date.now() + MENU_TIMEOUT_MS;
  for (;;) {
    const picked = await nextMenuInteraction(
      message,
      interaction.user.id,
      deadline,
    );
    if (picked === null) {
      await interaction.editReply({
        content:
          "This picker has expired. Run `/stream playback sports` for a fresh listing.",
        components: [],
      });
      return;
    }
    if (picked.isButton()) {
      page = await updateSportsPage(picked, events, page, allowSchedule);
      continue;
    }
    if (!picked.isStringSelectMenu())
      throw new Error("Unexpected sports picker interaction type");
    const event = selectedSportsEvent(
      events,
      page,
      picked.values[0],
      allowSchedule,
    );
    if (event === null) {
      await picked.reply({
        content:
          "That game is not available from this page. Choose a live or unconfirmed game from the menu.",
        flags: MessageFlags.Ephemeral,
      });
      continue;
    }
    await picked.deferUpdate();
    await interaction.editReply({
      content: `Checking **${truncateGraphemes(escapeMarkdown(event.title), 200)}**…`,
      components: [],
      allowedMentions: { parse: [] },
    });
    let content: string;
    try {
      content = await play(picked, event);
    } catch (error) {
      await interaction.editReply({
        content: "Something went wrong starting that game. Please try again.",
        embeds: [],
        components: [],
        allowedMentions: { parse: [] },
      });
      throw error;
    }
    await interaction.editReply({
      content,
      embeds: [],
      components: [],
      allowedMentions: { parse: [] },
    });
    return;
  }
}
