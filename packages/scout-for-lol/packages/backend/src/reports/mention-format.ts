// How many top-ranked rows of a ranked (non-TABLE, non-LIST) text report get
// `@mention`s instead of plain alias text.
export const TOP_MENTION_COUNT = 3;

/**
 * Render a ranked row's label, `@mention`ing its player(s) for the top
 * `TOP_MENTION_COUNT` ranks. Group labels (e.g. "Danny + Aaron + Kendrick")
 * mention each member independently; a member without a linked Discord ID
 * falls back to their plain alias.
 */
export function formatRankedLabel(
  label: string,
  index: number,
  aliasToDiscordId: Map<string, string>,
): string {
  if (index >= TOP_MENTION_COUNT) {
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
