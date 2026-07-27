import type { ReportMentionIdentity } from "#src/reports/query-engine.ts";

// Fallback rank count used when a `RENDER leaderboard` clause doesn't specify
// `WITH (mentions = ...)`.
export const DEFAULT_MENTION_COUNT = 3;

/**
 * Resolve a report's `RENDER leaderboard WITH (mentions = ...)` option (a
 * count, "all", or unset) to the concrete number of ranked rows to mention.
 */
export function resolveMentionCount(
  mentionsOption: number | "all" | undefined,
  totalRows: number,
): number {
  return mentionsOption === "all"
    ? totalRows
    : (mentionsOption ?? DEFAULT_MENTION_COUNT);
}

/**
 * Render a ranked row's label, `@mention`ing structured player identities for
 * ranks below `mentionCount`. Non-player rows have no mention identity and
 * always retain their display label.
 */
export function formatRankedLabel(params: {
  label: string;
  index: number;
  mentionIdentity: ReportMentionIdentity | null;
  /**
   * The current server player map. Its presence makes the map authoritative:
   * an absent player has been unlinked or deleted since the lake snapshot.
   * Omit it only for map-less preview paths, which must use the snapshot value.
   */
  playerDiscordIds?: Map<number, string>;
  mentionCount: number;
}): string {
  if (params.index >= params.mentionCount || params.mentionIdentity === null) {
    return params.label;
  }
  if (params.mentionIdentity.kind === "player") {
    const discordId =
      params.mentionIdentity.playerId === null
        ? params.mentionIdentity.discordId
        : params.playerDiscordIds === undefined
          ? params.mentionIdentity.discordId
          : (params.playerDiscordIds.get(params.mentionIdentity.playerId) ??
            null);
    return discordId === null
      ? params.mentionIdentity.alias
      : `<@${discordId}>`;
  }
  return params.mentionIdentity.members
    .map((member) => {
      const discordId = params.playerDiscordIds?.get(member.playerId);
      return discordId === undefined ? member.alias : `<@${discordId}>`;
    })
    .join(" + ");
}
