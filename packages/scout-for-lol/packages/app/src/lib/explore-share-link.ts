/**
 * Which share link the explore page shows, and how long a freshly minted token
 * stands in for the persisted one.
 *
 * Sharing mints a token server-side, then invalidates the transcript query to
 * read it back. Deriving the link from the read-back value alone means the link
 * row cannot render until that round trip lands — and never renders if the
 * refetch fails, leaving a share that genuinely succeeded with nothing on
 * screen to show for it. The mutation already knows the token, so it bridges
 * the gap.
 *
 * The bridge is deliberately short-lived: the persisted value wins whenever it
 * exists, and the bridge is dropped the moment the query reports a token. That
 * keeps the original property that a share revoked in another tab, a deleted
 * conversation, or a switch away all clear the link through the query cache,
 * with no stored copy to go stale.
 */

/** The token to render a link for, or null when there is nothing to show. */
export function resolveShareToken(input: {
  /** `conversation.shareToken` from the transcript query. Authoritative. */
  persisted: string | null;
  /** Minted by this session's share, awaiting read-back. */
  minted: string | null;
}): string | null {
  return input.persisted ?? input.minted;
}

/**
 * The bridge token after the query has reported `persisted`.
 *
 * Once the read-back arrives the bridge has done its job, and holding it any
 * longer is what would let a later revocation leave a stale link on screen.
 */
export function mintedAfterPersisted(input: {
  minted: string | null;
  persisted: string | null;
}): string | null {
  return input.persisted === null ? input.minted : null;
}

/** The absolute share URL for a token. */
export function exploreShareLink(
  origin: string,
  token: string | null,
): string | null {
  return token === null ? null : `${origin}/app/explore/s/${token}`;
}
