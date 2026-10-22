import { EmbedBuilder, escapeMarkdown } from "discord.js";
import type {
  ExploreLoadoutCard,
  ExploreMatchCard,
  ExploreMessage,
} from "@scout-for-lol/data";
import { getExploreMatchUrl } from "#src/discord/commands/links.ts";
import {
  exploreVisualizationPayload,
  type ExploreVisualizationPayload,
} from "#src/discord/scout/visualization.ts";

/**
 * Explore's match and loadout cards, as Discord embeds.
 *
 * The web renders these as rich components and voice keeps them in the saved
 * conversation; Discord gets the same cards, compressed to what an embed can
 * carry. They are the same frozen snapshots the answer was written against,
 * so an answer that says "see the card" is never pointing at nothing.
 */

/** Discord's ceiling on embeds in one message. */
export const DISCORD_MAX_EMBEDS = 10;
/** Neutral: a card has no single player's point of view to colour a result by. */
const CARD_COLOR = 0x5d_6d_7e;

function duration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes.toString()}:${(seconds % 60).toString().padStart(2, "0")}`;
}

function matchEmbed(card: ExploreMatchCard): EmbedBuilder {
  const { match } = card;
  const fields = match.teams.slice(0, 2).map((team) => ({
    name: `${team.win ? "Victory" : "Defeat"} — ${team.kills.toString()} kills`,
    value: team.participants
      .map(
        (participant) =>
          `${escapeMarkdown(participant.championName)} · ${escapeMarkdown(participant.riotId.gameName ?? "Unknown")} · ${participant.kills.toString()}/${participant.deaths.toString()}/${participant.assists.toString()}`,
      )
      .join("\n")
      .slice(0, 1024),
    inline: true,
  }));
  return new EmbedBuilder()
    .setTitle(
      `${match.queue ?? match.gameMode} · ${duration(match.gameDurationSeconds)}`,
    )
    .setURL(getExploreMatchUrl(match.matchId))
    .setColor(CARD_COLOR)
    .setTimestamp(new Date(match.gameCreationMs))
    .addFields(fields);
}

function loadoutEmbed(card: ExploreLoadoutCard): EmbedBuilder {
  const items = card.finalItems
    .flatMap((item) => (item.name === null ? [] : [escapeMarkdown(item.name)]))
    .join(", ");
  const spells = card.spells
    .flatMap((spell) => (spell.name === null ? [] : [spell.name]))
    .join(" + ");
  const runes = [
    card.runePage.keystone?.name,
    ...card.runePage.primaryRunes.map((rune) => rune.name),
    ...card.runePage.secondaryRunes.map((rune) => rune.name),
  ]
    .filter((name) => name !== undefined)
    .join(", ");
  return new EmbedBuilder()
    .setTitle(
      `${card.championName} loadout · ${duration(card.gameDurationSeconds)}`,
    )
    .setURL(getExploreMatchUrl(card.matchId))
    .setColor(CARD_COLOR)
    .addFields(
      { name: "Final items", value: items || "None recorded" },
      { name: "Spells", value: spells || "None recorded", inline: true },
      { name: "Runes", value: runes || "None recorded", inline: true },
    );
}

/** Every card on a saved answer, match cards first, capped to fit a message. */
export function exploreCardEmbeds(
  message: ExploreMessage,
  reserved: number,
): EmbedBuilder[] {
  return [
    ...message.matchCards.map((card) => matchEmbed(card)),
    ...message.loadoutCards.map((card) => loadoutEmbed(card)),
  ].slice(0, Math.max(0, DISCORD_MAX_EMBEDS - reserved));
}

/**
 * Everything an answer attaches on Discord: its visualization, then its cards.
 *
 * The private reply and the public post both send this, so a posted answer
 * shows exactly what its asker saw.
 */
export function exploreAnswerAttachments(
  message: ExploreMessage,
): ExploreVisualizationPayload {
  const visualization = exploreVisualizationPayload(message);
  const cards = exploreCardEmbeds(message, visualization.embeds?.length ?? 0);
  return cards.length === 0
    ? visualization
    : { ...visualization, embeds: [...(visualization.embeds ?? []), ...cards] };
}
