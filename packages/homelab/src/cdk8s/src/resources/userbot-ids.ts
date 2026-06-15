/**
 * Canonical list of every Discord *userbot* (real user account driven by a selfbot client,
 * not a bot application) deployed from this homelab. Each entry maps a stable internal key
 * to the userbot's Discord user ID.
 *
 * These IDs are not secrets — they're visible to anyone sharing a voice channel with the
 * bot — so they live in source rather than 1Password. Each bot's deployment reads its own
 * peers (everyone else's IDs) via the `PEER_USERBOT_IDS` env var; see {@link peerUserbotIds}.
 *
 * Why this matters: peer userbots are real Discord accounts, so `user.bot === false` for
 * them. Without an explicit peer list, a bot looking at its own voice channel can't tell
 * a peer userbot apart from a human, and two userbots will keep each other "occupied"
 * forever. See `packages/discord-stream-lifecycle/src/viewer-presence.ts`.
 */
export const USERBOT_IDS = {
  pokemon: "1094072953580310669",
  marioKart: "1513020384797266004",
  streambot: "1512972411639955466",
} as const satisfies Record<string, string>;

export type UserbotKey = keyof typeof USERBOT_IDS;

/**
 * Peer userbot IDs to pass to `<self>` via the `PEER_USERBOT_IDS` env var
 * (comma-separated). Returns the full {@link USERBOT_IDS} list minus `self`.
 */
export function peerUserbotIds(self: UserbotKey): string {
  return Object.entries(USERBOT_IDS)
    .filter(([key]) => key !== self)
    .map(([, id]) => id)
    .join(",");
}
