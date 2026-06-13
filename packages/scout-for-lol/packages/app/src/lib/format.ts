/** Format a date (or ISO string, as it arrives over the JSON wire) for display. */
export function formatDate(value: Date | string | null): string {
  if (value === null) return "—";
  return new Date(value).toLocaleString();
}

/** Resolve a channel id to a `#name` label using the guild channel list. */
export function channelLabel(
  channels: { id: string; name: string }[] | undefined,
  channelId: string,
): string {
  const channel = channels?.find((candidate) => candidate.id === channelId);
  return channel === undefined ? channelId : `#${channel.name}`;
}
