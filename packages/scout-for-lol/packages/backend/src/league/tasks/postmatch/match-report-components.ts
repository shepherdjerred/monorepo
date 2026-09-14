import type { MatchId } from "@scout-for-lol/data/index.ts";
import type { MessageCreateOptions } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { getExploreMatchUrl } from "#src/discord/commands/links.ts";

/**
 * One link button pointing at the match's Explore page. The URL is
 * channel-independent, so the same message can fan out to every subscribed
 * channel unchanged. Standard-path reports only: the Explore match page
 * rejects Arena and Classic asset modes (`isExploreMatchSnapshotSupported`),
 * so those report paths must not attach this button.
 */
export function matchLinkComponents(
  matchId: MatchId,
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
