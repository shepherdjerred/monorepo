/**
 * Batch-resolve Discord user IDs to display names/avatars for the web UI.
 *
 * Domain payloads (players, subscriptions, competitions, audit log) store
 * raw Discord snowflakes. The dashboard wants human-readable names, so we
 * resolve them via the bot's gateway client (`client.users.fetch`), backed
 * by a short in-memory TTL cache to avoid re-fetching the same IDs across a
 * burst of reads. Resolution is fail-soft: on any error we return the raw ID
 * as the name and do NOT cache the failure (so a transient gateway hiccup
 * doesn't pin a user to its raw ID for the whole TTL).
 */

import { z } from "zod";
import { client as discordClient } from "#src/discord/client.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("discord-resolve-users");

export const ResolvedDiscordUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  avatar: z.string().nullable(),
});
export type ResolvedDiscordUser = z.infer<typeof ResolvedDiscordUserSchema>;

type CacheEntry = { user: ResolvedDiscordUser; fetchedAt: number };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000;
/** Hard cap so a single call can't fan out to the gateway unbounded. */
export const MAX_IDS_PER_RESOLVE = 100;

function fallback(id: string): ResolvedDiscordUser {
  return { id, username: id, displayName: id, avatar: null };
}

async function resolveOne(id: string): Promise<ResolvedDiscordUser> {
  const cached = cache.get(id);
  if (cached !== undefined && Date.now() - cached.fetchedAt < TTL_MS) {
    return cached.user;
  }
  cache.delete(id);
  try {
    const user = await discordClient.users.fetch(id);
    const resolved: ResolvedDiscordUser = {
      id,
      username: user.username,
      displayName: user.globalName ?? user.username,
      avatar: user.displayAvatarURL(),
    };
    cache.set(id, { user: resolved, fetchedAt: Date.now() });
    return resolved;
  } catch (error) {
    logger.debug("Discord user resolve failed; falling back to raw id", {
      id,
      error,
    });
    return fallback(id);
  }
}

/**
 * Resolve a set of Discord IDs. Deduplicates, caps to MAX_IDS_PER_RESOLVE,
 * and returns a lookup keyed by id. Never rejects — unresolved IDs map to a
 * fallback entry whose name is the raw id.
 */
export async function resolveDiscordUsers(
  ids: readonly string[],
): Promise<Record<string, ResolvedDiscordUser>> {
  const unique = [...new Set(ids)].slice(0, MAX_IDS_PER_RESOLVE);
  const resolved = await Promise.all(unique.map((id) => resolveOne(id)));
  return Object.fromEntries(resolved.map((user) => [user.id, user]));
}
