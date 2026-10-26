import { formatDareCustomId } from "#src/dares/lifecycle/dare-custom-id.ts";
import { getExploreConversationUrl } from "#src/discord/commands/links.ts";
import type { DareState } from "@scout-for-lol/data";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

export function dareDraftComponents(input: {
  intentId: string;
  dareId: number;
  revision: number;
  conversationId: string;
}): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          formatDareCustomId({
            kind: "intent",
            intentId: input.intentId,
          }),
        )
        .setLabel("Confirm and publish")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setLabel("Revise in Explore")
        .setStyle(ButtonStyle.Link)
        .setURL(getExploreConversationUrl(input.conversationId)),
      new ButtonBuilder()
        .setCustomId(
          formatDareCustomId({
            kind: "delete",
            dareId: input.dareId,
            revision: input.revision,
          }),
        )
        .setLabel("Cancel draft")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

export function dareIntentConfirmationComponents(
  intentId: string,
): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(formatDareCustomId({ kind: "intent", intentId }))
        .setLabel("Confirm")
        .setStyle(ButtonStyle.Success),
    ),
  ];
}

function prepareButton(input: {
  dareId: number;
  revision: number;
  action: "accept" | "decline" | "cancel";
  label: string;
  style: ButtonStyle;
}): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(
      formatDareCustomId({
        kind: "prepare",
        dareId: input.dareId,
        revision: input.revision,
        action: input.action,
      }),
    )
    .setLabel(input.label)
    .setStyle(input.style);
}

export function dareCalloutComponents(input: {
  state: DareState;
  dareId: number;
  revision: number;
}): ActionRowBuilder<ButtonBuilder>[] {
  if (input.state === "pending_accept") {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        prepareButton({
          ...input,
          action: "accept",
          label: "Accept",
          style: ButtonStyle.Success,
        }),
        prepareButton({
          ...input,
          action: "decline",
          label: "Decline",
          style: ButtonStyle.Danger,
        }),
        prepareButton({
          ...input,
          action: "cancel",
          label: "Cancel",
          style: ButtonStyle.Secondary,
        }),
      ),
    ];
  }
  return [];
}
