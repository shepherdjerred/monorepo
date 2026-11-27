import type { DiscordGuildId } from "@scout-for-lol/data";

export type ServerOption = { guildId: DiscordGuildId; name: string };

/**
 * The servers a toggle leaves selected. The last selected server cannot be
 * turned off, and selecting every server is the same as no selection (the page
 * default), so a toggle that lands there returns `undefined` and keeps the
 * query on its default cache entry.
 */
export function toggleServer(
  available: readonly ServerOption[],
  selected: readonly DiscordGuildId[] | undefined,
  toggled: DiscordGuildId,
): DiscordGuildId[] | undefined {
  const current = selected ?? available.map((server) => server.guildId);
  const next = current.includes(toggled)
    ? current.filter((guildId) => guildId !== toggled)
    : [...current, toggled];
  if (next.length === 0)
    return selected === undefined ? undefined : [...selected];
  return next.length === available.length ? undefined : next;
}
