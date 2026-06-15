/**
 * Discord button pagination for `/stream sources`. Lives outside the command handler so the
 * handler stays discord.js-free and unit-testable, and outside `command-bot.ts` so that file
 * stays under the max-lines cap.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type ChatInputCommandInteraction,
  ComponentType,
  type MessageActionRowComponentBuilder,
  MessageFlags,
} from "discord.js";
import type { SourcesPages } from "@shepherdjerred/streambot/discord/help-text.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("pagination");

// How long the Prev/Next buttons stay active. Matches Discord's ~15-min ephemeral-message
// window with margin so the row disappears before clicks would 404.
const PAGINATION_TIMEOUT_MS = 5 * 60 * 1000;

const ButtonId = {
  First: "sources_first",
  Prev: "sources_prev",
  Next: "sources_next",
  Last: "sources_last",
} as const;

/**
 * Edit the deferred ephemeral reply with a paginated payload. Renders a single page + button row,
 * then runs a 5-minute message-component collector scoped to the invoking user — each click flips
 * to the new page via `buttonInteraction.update`. On timeout the row is cleared and the last-shown
 * page stays. Single-page payloads just edit in the message with no buttons.
 */
export async function sendPaginatedReply(
  interaction: ChatInputCommandInteraction,
  payload: SourcesPages,
): Promise<void> {
  const { header, pages } = payload;
  const totalPages = pages.length;
  let page = 0;
  const content = renderPaginatedContent(header, pages, page);
  const components =
    totalPages > 1 ? [buildPaginationButtons(page, totalPages)] : [];
  await interaction.editReply({ content, components });
  if (totalPages <= 1) {
    return;
  }

  const message = await interaction.fetchReply();
  // Note: no collector `filter` — authorization happens in `handlePaginationClick` so
  // non-invoker clicks get the explanatory "not for you" ephemeral reply instead of
  // discord.js dropping the interaction (which would surface as "Interaction Failed").
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: PAGINATION_TIMEOUT_MS,
  });

  collector.on("collect", (button: ButtonInteraction) => {
    void handlePaginationClick(button, interaction.user.id, () => {
      switch (button.customId) {
        case ButtonId.First:
          page = 0;
          break;
        case ButtonId.Prev:
          page = Math.max(0, page - 1);
          break;
        case ButtonId.Next:
          page = Math.min(totalPages - 1, page + 1);
          break;
        case ButtonId.Last:
          page = totalPages - 1;
          break;
      }
      return {
        content: renderPaginatedContent(header, pages, page),
        components: [buildPaginationButtons(page, totalPages)],
      };
    });
  });

  collector.on("end", () => {
    void clearPaginationButtons(interaction);
  });
}

async function clearPaginationButtons(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  try {
    await interaction.editReply({ components: [] });
  } catch (error) {
    log.warn("clearing pagination buttons failed", {
      error: getErrorMessage(error),
    });
  }
}

async function handlePaginationClick(
  button: ButtonInteraction,
  invokerId: string,
  next: () => {
    content: string;
    components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
  },
): Promise<void> {
  if (button.user.id !== invokerId) {
    await button.reply({
      content: "These buttons aren't for you — run `/stream sources` yourself.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await button.update(next());
}

/** Render one page of a paginated reply: header line, page body, then a `Page X of Y` footer. */
function renderPaginatedContent(
  header: string,
  pages: readonly string[],
  pageIndex: number,
): string {
  const body = pages[pageIndex] ?? "";
  if (pages.length <= 1) {
    return `${header}\n${body}`;
  }
  const footer = `_Page ${String(pageIndex + 1)} of ${String(pages.length)}_`;
  return `${header}\n${body}\n${footer}`;
}

/** First / Prev / Next / Last row, with edge buttons disabled at page bounds. */
function buildPaginationButtons(
  currentPage: number,
  totalPages: number,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const atStart = currentPage === 0;
  const atEnd = currentPage >= totalPages - 1;
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ButtonId.First)
      .setLabel("⏮ First")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atStart),
    new ButtonBuilder()
      .setCustomId(ButtonId.Prev)
      .setLabel("◀ Prev")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(atStart),
    new ButtonBuilder()
      .setCustomId(ButtonId.Next)
      .setLabel("Next ▶")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(atEnd),
    new ButtonBuilder()
      .setCustomId(ButtonId.Last)
      .setLabel("Last ⏭")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atEnd),
  );
}
