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
 * Render a ranked row's label, `@mention`ing its player(s) for ranks below
 * `mentionCount`. Group labels (e.g. "Danny + Aaron + Kendrick") mention each
 * member independently; a member without a linked Discord ID falls back to
 * their plain alias.
 */
export function formatRankedLabel(
  label: string,
  index: number,
  aliasToDiscordId: Map<string, string>,
  mentionCount: number,
): string {
  if (index >= mentionCount) {
    return label;
  }
  return label
    .split(" + ")
    .map((alias) => {
      const discordId = aliasToDiscordId.get(alias);
      return discordId === undefined ? alias : `<@${discordId}>`;
    })
    .join(" + ");
}
