import type { DiscordGuildId } from "@scout-for-lol/domain/identity/discord.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
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

export function getHallOfFameUrl(guildId: DiscordGuildId): string {
  return `${getOrigin()}/app/halls/${guildId}`;
}
