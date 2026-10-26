import type { RiotMatchId } from "@scout-for-lol/data/index.ts";
import {
  type MessageCreateOptions,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { getExploreMatchUrl } from "#src/discord/commands/links.ts";

export function inlineMatchLink(matchId: RiotMatchId): string {
  return `[View match](${getExploreMatchUrl(matchId)})`;
}

/**
 * Legacy link button retained to rebuild receipts rendered before match links
 * moved inline. Standard-path reports only: the Explore match page rejects
 * Arena and Classic asset modes (`isExploreMatchSnapshotSupported`).
 */
export function matchLinkComponents(
  matchId: RiotMatchId,
): NonNullable<MessageCreateOptions["components"]> {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("View match")
        .setURL(getExploreMatchUrl(matchId)),
    ),
  ];
}
