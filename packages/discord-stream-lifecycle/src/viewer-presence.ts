/**
 * "Real viewer" filter for Go Live userbots that share voice channels with peer userbots.
 *
 * A userbot looking at its own voice channel cannot rely on `user.bot` to find real humans —
 * peer userbots are authenticated user accounts (via discord.js-selfbot-v13), so `user.bot`
 * is false for them. Without filtering, two userbots in the same channel keep each other
 * "occupied" forever.
 *
 * This helper combines two exclusions:
 *  1. The canonical {@link KNOWN_USERBOT_IDS} list — every userbot in this monorepo registers
 *     its Discord user ID here. Each consumer subtracts its own `selfUserId` at runtime.
 *  2. A Go-Live-userbot fingerprint (streaming + selfDeaf + selfMute) — only active when
 *     `KNOWN_USERBOT_IDS` (and any caller-supplied `peerUserbotIds` override) is empty. Once
 *     the canonical list is populated the heuristic is disabled so that a human streaming
 *     while self-muted and self-deafened is not silently counted as zero real viewers.
 */

/**
 * Canonical list of every userbot Discord user ID across this monorepo. Each consumer
 * subtracts its own `selfUserId` and the rest are excluded from the "real viewers" tally.
 *
 * Add new userbots here when they're introduced — this is the single source of truth. Discord
 * user IDs are not secrets, so keeping them in source avoids any 1Password/Helm/cdk8s wiring.
 */
export const KNOWN_USERBOT_IDS: readonly string[] = [
  "1094072953580310669", // Pokébot
  "1513020384797266004", // Glitter Kart (Mario Kart)
  "1512972411639955466", // Streambot
];

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
   * Additional peer userbot IDs beyond {@link KNOWN_USERBOT_IDS} (e.g. for tests or ad-hoc
   * overrides). The canonical list already covers the in-tree userbots — most callers can
   * omit this.
   */
  readonly peerUserbotIds?: readonly string[];
  /** Exclude `user.bot === true` members (regular bot applications). Default `true`. */
  readonly excludeBots?: boolean;
  /**
   * Exclude members that look like Go Live userbots: streaming with both self-mute and
   * self-deaf set.
   *
   * Defaults to `true` **only when no explicit `peerUserbotIds` is supplied** — the
   * heuristic then catches any userbot that isn't in {@link KNOWN_USERBOT_IDS} either.
   * When the caller provides `peerUserbotIds` the heuristic is off, so a human streaming
   * while self-muted and self-deafened is not silently excluded.
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
  if (KNOWN_USERBOT_IDS.includes(candidate.id)) {
    return false;
  }
  if (opts.peerUserbotIds?.includes(candidate.id) === true) {
    return false;
  }
  // The Go-Live fingerprint is the default catch-all for any 4th userbot not yet
  // registered in `KNOWN_USERBOT_IDS`. It's only suppressed when the caller supplies an
  // explicit `peerUserbotIds` — that signals "I've named every peer myself", at which
  // point the heuristic risks excluding a human streaming while self-muted/self-deafened.
  // Callers can also force the heuristic explicitly via `excludeLikelyUserbots`.
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
