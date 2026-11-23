/** Collapse dynamic route segments before any pathname reaches analytics. */
export function normalizePath(pathname: string): string {
  const normalized = pathname
    .replace(/^\/replays\/[^/]+/, "/replays/:replayId")
    .replace(/^\/players\/[^/]+/, "/players/:playerId")
    .replace(
      /^\/players\/:playerId\/matches\/[^/]+/,
      "/players/:playerId/matches/:matchId",
    )
    .replace(/^\/champions\/[^/]+/, "/champions/:championId")
    .replace(/^\/halls\/[^/]+/, "/halls/:guildId")
    .replace(/^\/challenge-runs\/[^/]+/, "/challenge-runs/:runId")
    .replace(/^\/challenges\/drafts\/[^/]+/, "/challenges/drafts/:draftId")
    .replace(
      /^\/challenges\/(?!drafts(?:\/|$))[^/]+/,
      "/challenges/:templateId",
    )
    .replace(/^\/duels\/[^/]+/, "/duels/:guildId")
    .replace(
      /^\/duels\/:guildId\/events\/[^/]+/,
      "/duels/:guildId/events/:eventId",
    )
    .replace(
      /^\/duels\/:guildId\/series\/[^/]+/,
      "/duels/:guildId/series/:seriesId",
    )
    .replace(/^\/g\/[^/]+/, "/g/:guildId")
    .replace(/^\/g\/:guildId\/players\/[^/]+/, "/g/:guildId/players/:alias")
    .replace(
      /\/competitions\/(?!new(?:\/|$))[^/]+/,
      "/competitions/:competitionId",
    )
    .replace(
      /\/reports\/(?!new(?:\/|$)|help(?:\/|$))[^/]+/,
      "/reports/:reportId",
    )
    .replace(/^\/dares\/(?!settings$)[^/]+/, "/dares/:dareId")
    // Normalize the share credential before the conversation rule sees it.
    .replace(/^\/explore\/s\/[^/]+/, "/explore/s/:shareToken")
    .replace(/^\/explore\/matches\/[^/]+/, "/explore/matches/:matchId")
    .replace(
      /^\/explore\/(?!s(?:\/|$)|matches(?:\/|$))[^/]+/,
      "/explore/:conversationId",
    );
  const knownRoute =
    /^(?:\/|\/(?:login|welcome|installed|manage)|\/replays\/:replayId|\/explore(?:\/(?::conversationId|s\/:shareToken|matches\/:matchId))?|\/players(?:\/:playerId(?:\/matches\/:matchId)?)?|\/champions\/:championId|\/halls\/:guildId|\/challenges(?:\/(?:drafts\/:draftId|:templateId))?|\/clash|\/challenge-runs\/:runId|\/duels\/:guildId(?:\/(?:events\/:eventId(?:\/standings)?|series\/:seriesId|head-to-head))?|\/dares(?:\/(?:settings|:dareId))?|\/g\/:guildId(?:\/(?:access|audit|subscriptions|players(?:\/:alias(?:\/manage)?)?|competitions(?:\/(?:new|:competitionId(?:\/edit)?))?|reports(?:\/(?:new|help|:reportId(?:\/edit)?))?|hall-of-fame)?)?)$/;
  return knownRoute.test(normalized) ? normalized : "/not-found";
}
