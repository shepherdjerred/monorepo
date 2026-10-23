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
  formatScoutFollowUpCustomId,
  formatScoutPublishCustomId,
} from "#src/discord/scout/custom-id.ts";

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
        .setLabel(
          followUp.length > MAX_BUTTON_LABEL
            ? `${followUp.slice(0, MAX_BUTTON_LABEL - 1)}…`
            : followUp,
        )
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
