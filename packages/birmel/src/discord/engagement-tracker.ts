/**
 * Per-channel "engagement" tracking for conversational triggering.
 *
 * The bot becomes "engaged" in a channel whenever it is directly talked to
 * (an @mention or wake word) or when it sends a reply. While a channel is
 * engaged — i.e. within `windowMs` of the last engagement — subsequent
 * allowed-user messages are run through the should-respond classifier so the
 * bot can follow a conversation without being re-pinged every turn.
 *
 * State is intentionally in-memory: the engagement window (minutes) is far
 * shorter than any meaningful process restart, so persistence would add cost
 * without benefit. This mirrors the in-memory dedup `Set` already used in
 * `discord/events/message-create.ts`.
 */

const lastEngagement = new Map<string, number>();

/**
 * Mark a channel as engaged as of now.
 */
export function markEngaged(channelId: string): void {
  lastEngagement.set(channelId, Date.now());
}

/**
 * Whether a channel has been engaged within the last `windowMs`. Lazily
 * evicts stale entries on read so the map cannot grow unbounded.
 */
export function isRecentlyEngaged(channelId: string, windowMs: number): boolean {
  const last = lastEngagement.get(channelId);
  if (last == null) {
    return false;
  }
  if (Date.now() - last > windowMs) {
    lastEngagement.delete(channelId);
    return false;
  }
  return true;
}

/**
 * Test helper: clear all tracked engagement state.
 */
export function resetEngagement(): void {
  lastEngagement.clear();
}
