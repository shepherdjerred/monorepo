/**
 * "Real viewer" filter for Go Live userbots that share voice channels with peer userbots.
 *
 * A userbot looking at its own voice channel cannot rely on `user.bot` to find real humans —
 * peer userbots are authenticated user accounts (via discord.js-selfbot-v13), so `user.bot`
 * is false for them. Without filtering, two userbots in the same channel keep each other
 * "occupied" forever.
 *
 * This helper combines two exclusions: an explicit list of known peer userbot user IDs (the
 * reliable signal when configured) and a Go-Live-userbot fingerprint (streaming + selfDeaf +
 * selfMute — a human Go Liver almost always wants to hear and talk).
 */

export type ViewerCandidate = {
  readonly id: string;
  /** `user.bot` from Discord — true for real bot applications, false for userbots and humans. */
  readonly isBot: boolean;
  /** `VoiceState.streaming` — Go Live is active. */
  readonly streaming: boolean;
  /** `VoiceState.selfDeaf` — the user has self-deafened. */
  readonly selfDeaf: boolean;
  /** `VoiceState.selfMute` — the user has self-muted. */
  readonly selfMute: boolean;
};

export type ViewerPresenceOptions = {
  /** The userbot's own user ID — always excluded from the count. */
  readonly selfUserId: string;
  /** User IDs of known peer userbots that share this voice channel. */
  readonly peerUserbotIds?: readonly string[];
  /** Exclude `user.bot === true` members (regular bot applications). Default `true`. */
  readonly excludeBots?: boolean;
  /**
   * Exclude members that look like Go Live userbots: streaming with both self-mute and
   * self-deaf set. Default `true`.
   */
  readonly excludeLikelyUserbots?: boolean;
};

/** True iff `candidate` should count toward the "real viewers" tally for `opts`. */
export function isRealViewer(
  candidate: ViewerCandidate,
  opts: ViewerPresenceOptions,
): boolean {
  if (candidate.id === opts.selfUserId) {
    return false;
  }
  if ((opts.excludeBots ?? true) && candidate.isBot) {
    return false;
  }
  if (opts.peerUserbotIds?.includes(candidate.id) === true) {
    return false;
  }
  if (
    (opts.excludeLikelyUserbots ?? true) &&
    candidate.streaming &&
    candidate.selfDeaf &&
    candidate.selfMute
  ) {
    return false;
  }
  return true;
}

/** Count the members of `candidates` that pass {@link isRealViewer}. */
export function countRealViewers(
  candidates: Iterable<ViewerCandidate>,
  opts: ViewerPresenceOptions,
): number {
  let count = 0;
  for (const candidate of candidates) {
    if (isRealViewer(candidate, opts)) {
      count += 1;
    }
  }
  return count;
}
