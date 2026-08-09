/** Pure decision helpers for the Discord surfaces.
 *
 *  Deliberately imports neither `configuration.ts` (which throws at import
 *  time when required env vars are missing) nor the database, so every rule
 *  here is unit-testable without a live bot. The I/O layers — `reactions.ts`
 *  and `context-menu.ts` — compose these with Discord and Prisma calls. */

/** Does this reaction's emoji match the configured karma emoji?
 *
 *  Matches on name or id so both unicode emoji (whose `name` is the character
 *  itself) and custom guild emoji (matched by snowflake id) work. */
export function emojiMatchesKarma(
  emoji: { name: string | null; id: string | null },
  configured: string,
): boolean {
  return emoji.name === configured || emoji.id === configured;
}

export type ReactionAward =
  | { action: "ignore"; reason: string }
  | { action: "award"; receiverId: string };

/** Decide what a karma reaction should do. */
export function decideReactionAward(params: {
  emojiMatches: boolean;
  guildId: string | null;
  reactorId: string;
  authorId: string | undefined;
  authorIsBot: boolean;
}): ReactionAward {
  if (!params.emojiMatches) {
    return { action: "ignore", reason: "not the karma emoji" };
  }
  if (params.guildId === null) {
    return { action: "ignore", reason: "not in a guild" };
  }
  if (params.authorId === undefined) {
    return { action: "ignore", reason: "message author is unknown" };
  }
  if (params.authorIsBot) {
    return { action: "ignore", reason: "message author is a bot" };
  }
  if (params.authorId === params.reactorId) {
    // Deliberately not the self-give penalty the slash command applies:
    // reacting to your own message is usually expressive, not an attempt to
    // farm karma, and punishing it would make the emoji feel like a trap.
    return { action: "ignore", reason: "reacting to your own message" };
  }
  return { action: "award", receiverId: params.authorId };
}

const MODAL_PREFIX = "karma-give";

/** Encode the context-menu target into the modal's custom id.
 *
 *  Discord hands the modal submission no reference back to the message that
 *  opened it, so the target must round-trip through the id. Two snowflakes
 *  plus the prefix stays well inside the 100-character limit. */
export function encodeModalId(messageId: string, authorId: string): string {
  return `${MODAL_PREFIX}:${messageId}:${authorId}`;
}

export function decodeModalId(
  customId: string,
): { messageId: string; authorId: string } | null {
  const parts = customId.split(":");
  if (parts.length !== 3) {
    return null;
  }
  const [prefix, messageId, authorId] = parts;
  if (prefix !== MODAL_PREFIX) {
    return null;
  }
  if (messageId === undefined || messageId === "") {
    return null;
  }
  if (authorId === undefined || authorId === "") {
    return null;
  }
  return { messageId, authorId };
}
