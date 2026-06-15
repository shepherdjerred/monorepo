/**
 * "Real viewer" filter for Go Live userbots that share voice channels with peer userbots.
 *
 * A userbot looking at its own voice channel cannot rely on `user.bot` to find real humans —
 * peer userbots are authenticated user accounts (via discord.js-selfbot-v13), so `user.bot`
 * is false for them. Without filtering, two userbots in the same channel keep each other
 * "occupied" forever.
 *
 * This helper combines two exclusions:
 *  1. A caller-supplied `peerUserbotIds` list — the reliable signal. Each deployment owns
 *     the canonical list (in this monorepo: homelab cdk8s defines it and passes each bot
 *     its peers via the `PEER_USERBOT_IDS` env var). This library has no opinion on the
 *     contents.
 *  2. A Go-Live-userbot fingerprint (streaming + selfDeaf + selfMute) — only active when
 *     `peerUserbotIds` is **not** supplied (or is empty). When the caller has named every
 *     peer the heuristic is disabled so a human streaming while self-muted and self-deafened
 *     is not silently excluded.
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
  /**
   * The userbot's own user ID — always excluded from the count.
   * When `null` or `undefined`, self-exclusion is skipped (no channel member will have
   * id `null`, so omitting it is safe when the streamer identity is unknown at call time).
   */
  readonly selfUserId?: string | null;
  /**
   * User IDs of peer userbots that share this voice channel. The deployment owns the
   * canonical list (e.g. defined in homelab cdk8s and passed via `PEER_USERBOT_IDS` env)
   * and supplies it here at runtime; this library has no opinion on its contents.
   */
  readonly peerUserbotIds?: readonly string[];
  /** Exclude `user.bot === true` members (regular bot applications). Default `true`. */
  readonly excludeBots?: boolean;
  /**
   * Exclude members that look like Go Live userbots: streaming with both self-mute and
   * self-deaf set.
   *
   * Defaults to `true` **only when no `peerUserbotIds` is supplied** (or it's empty) — the
   * heuristic then acts as a catch-all for any userbot the deployment forgot to register.
   * When `peerUserbotIds` is non-empty the heuristic is off, so a human streaming while
   * self-muted and self-deafened is not silently excluded.
   *
   * Set explicitly to `true` to force the heuristic regardless.
   */
  readonly excludeLikelyUserbots?: boolean;
};

/** True iff `candidate` should count toward the "real viewers" tally for `opts`. */
export function isRealViewer(
  candidate: ViewerCandidate,
  opts: ViewerPresenceOptions,
): boolean {
  if (opts.selfUserId != null && candidate.id === opts.selfUserId) {
    return false;
  }
  if ((opts.excludeBots ?? true) && candidate.isBot) {
    return false;
  }
  if (opts.peerUserbotIds?.includes(candidate.id) === true) {
    return false;
  }
  // The Go-Live fingerprint is the default catch-all for any peer userbot the deployment
  // didn't register. It's suppressed when `peerUserbotIds` is non-empty — that signals
  // "I've named every peer", at which point the heuristic risks excluding a human
  // streaming while self-muted/self-deafened. Callers can also force it explicitly via
  // `excludeLikelyUserbots`.
  const hasPeerList =
    opts.peerUserbotIds !== undefined && opts.peerUserbotIds.length > 0;
  const useHeuristic = opts.excludeLikelyUserbots ?? !hasPeerList;
  if (
    useHeuristic &&
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
