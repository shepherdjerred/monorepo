import type { DiscordGuildId } from "@scout-for-lol/domain/identity/discord.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { SCOUT_GUILD_PAGES, type ScoutGuildPage } from "@scout-for-lol/data";
import configuration from "#src/configuration.ts";

function getOrigin(): string {
  return (configuration.webAppOrigin ?? "https://scout-for-lol.com").replace(
    /\/$/u,
    "",
  );
}

export function getDashboardUrl(): string {
  return `${getOrigin()}/app/`;
}

export function getDocsUrl(): string {
  return `${getOrigin()}/docs/`;
}

export function getExploreConversationUrl(conversationId: string): string {
  return `${getOrigin()}/app/explore/${conversationId}`;
}

export function getExploreMatchUrl(matchId: RiotMatchId): string {
  return `${getOrigin()}/app/explore/matches/${matchId}`;
}

/** One of a server's management pages in the web app. */
export function getGuildPageUrl(
  guildId: DiscordGuildId,
  page: ScoutGuildPage,
): string {
  return `${getOrigin()}/app/g/${guildId}/${SCOUT_GUILD_PAGES[page]}`;
}

export function getHallOfFameUrl(guildId: DiscordGuildId): string {
  return `${getOrigin()}/app/halls/${guildId}`;
}
