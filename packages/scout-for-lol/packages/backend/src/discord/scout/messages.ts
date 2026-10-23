import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  escapeMarkdown,
} from "discord.js";
import type { ExploreMessage } from "@scout-for-lol/data";
import { getExploreConversationUrl } from "#src/discord/commands/links.ts";
import { splitMessageIntoChunks } from "#src/discord/utils/message.ts";
import {
  formatScoutCreateCustomId,
  formatScoutFollowUpCustomId,
  formatScoutPublishCustomId,
} from "#src/discord/scout/custom-id.ts";
import { preparedIntents } from "#src/explore/creation/intent-replay.ts";

export const NO_GENERATED_MENTIONS = { parse: [] } as const;

export function exploreAnswerChunks(message: ExploreMessage): string[] {
  return splitMessageIntoChunks(formatAnswer(message));
}

export function publicExploreChunks(input: {
  username: string;
  question: string;
  answer: ExploreMessage;
}): string[] {
  const quotedQuestion = input.question
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return splitMessageIntoChunks(
    `**${escapeMarkdown(input.username)} asked Scout:**\n${quotedQuestion}\n\n${formatAnswer(input.answer)}`,
  );
}

export function exploreActionRow(input: {
  conversationId: string;
  assistantMessageId: string;
  posted: boolean;
}): ActionRowBuilder<ButtonBuilder> {
  const publish = new ButtonBuilder()
    .setCustomId(
      formatScoutPublishCustomId({
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
      }),
    )
    .setLabel(input.posted ? "Posted" : "Post publicly")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(input.posted);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("Open in Explore")
      .setStyle(ButtonStyle.Link)
      .setURL(getExploreConversationUrl(input.conversationId)),
    publish,
  );
}

/** Discord's ceiling on a button label. */
const MAX_BUTTON_LABEL = 80;
/** Discord's ceiling on buttons in one row. */
const MAX_ROW_BUTTONS = 5;

function buttonLabel(text: string): string {
  return text.length > MAX_BUTTON_LABEL
    ? `${text.slice(0, MAX_BUTTON_LABEL - 1)}…`
    : text;
}

/**
 * A Confirm button for each creation the answer prepared.
 *
 * The same proposal the web shows as a card, accepted where the person asked.
 * Pressing it runs the shared confirm path, which re-authorizes the clicker
 * and claims the intent once; a second press replays the first result.
 */
export function exploreCreationConfirmRows(
  answer: ExploreMessage,
): ActionRowBuilder<ButtonBuilder>[] {
  // Every prepared card gets a button: a dropped one would expire unseen.
  const intents = preparedIntents(answer.trace);
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let start = 0; start < intents.length; start += MAX_ROW_BUTTONS) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        intents.slice(start, start + MAX_ROW_BUTTONS).map((intent) =>
          new ButtonBuilder()
            .setCustomId(
              formatScoutCreateCustomId({ intentId: intent.intentId }),
            )
            .setLabel(buttonLabel(`Confirm: ${intent.summary}`))
            .setStyle(ButtonStyle.Success),
        ),
      ),
    );
  }
  return rows;
}

/** Discord's limit on component rows in one message. */
export const MAX_MESSAGE_ROWS = 5;

/**
 * The answer's follow-up suggestions, as buttons that ask them next.
 *
 * The same chips the web shows under an answer. Each one continues this
 * conversation from this answer, so Discord keeps the thread the web keeps.
 */
export function exploreFollowUpRow(input: {
  conversationId: string;
  answer: ExploreMessage;
}): ActionRowBuilder<ButtonBuilder> | null {
  if (input.answer.followUps.length === 0) return null;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    input.answer.followUps.slice(0, 3).map((followUp, index) =>
      new ButtonBuilder()
        .setCustomId(
          formatScoutFollowUpCustomId({
            conversationId: input.conversationId,
            assistantMessageId: input.answer.id,
            index,
          }),
        )
        .setLabel(buttonLabel(followUp))
        .setStyle(ButtonStyle.Secondary),
    ),
  );
}

function formatAnswer(message: ExploreMessage): string {
  if (message.caveats.length === 0) {
    return message.content;
  }
  return `${message.content}\n\n**Caveats**\n${message.caveats
    .map((caveat) => `- ${caveat}`)
    .join("\n")}`;
}
