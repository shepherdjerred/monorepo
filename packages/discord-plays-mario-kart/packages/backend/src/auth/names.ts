// Discord names in, overlay-safe player names out.
//
// The stream burns each player's name in with a Latin font that cannot shape
// emoji or other scripts, so the seat name is folded to printable ASCII
// (`PlayerNameSchema`). Accents fold to their base letter; anything else is
// dropped.
import {
  PLAYER_NAME_MAX,
  PlayerNameSchema,
} from "@discord-plays-mario-kart/common";

/** Fold one candidate name to printable ASCII, or undefined if nothing survives. */
export function foldPlayerName(raw: string): string | undefined {
  const folded = raw
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .replaceAll(/[\P{ASCII}\p{Cc}]/gu, "")
    .replaceAll(/\s+/gu, " ")
    .trim()
    .slice(0, PLAYER_NAME_MAX)
    .trim();
  const parsed = PlayerNameSchema.safeParse(folded);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The first candidate that folds to a usable name: server nickname, then the
 * global display name, then the username. Discord usernames are lowercase
 * ASCII, so the last candidate always survives.
 */
export function toPlayerName(
  candidates: readonly (string | null | undefined)[],
  username: string,
): string {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    const name = foldPlayerName(candidate);
    if (name !== undefined) return name;
  }
  const fallback = foldPlayerName(username);
  if (fallback === undefined) {
    throw new Error("a Discord username folded to an empty player name");
  }
  return fallback;
}

/** Discord CDN URL for a user's avatar hash, or null for the default avatar. */
export function avatarUrl(
  discordId: string,
  hash: string | null,
): string | null {
  if (hash === null) return null;
  const extension = hash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${discordId}/${hash}.${extension}?size=128`;
}
