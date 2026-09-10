/**
 * Batch-resolve Discord user IDs to display names/avatars for the web UI.
 *
 * Domain payloads (players, subscriptions, competitions, audit log) store raw
 * Discord snowflakes. The dashboard wants human-readable names, so we resolve
 * them over the bot REST API (`GET /users/{id}`), TTL-cached in
 * `bot-rest.ts` to avoid re-fetching the same IDs across a burst of reads.
 *
 * This used to go through `client.users.fetch`, whose REST client only carries
 * a token once `client.login()` has run — so on a pod serving HTTP without a
 * gateway connection every name silently degraded to a raw snowflake.
 * Resolution stays fail-soft: on any error we return the raw ID as the name and
 * do NOT cache the failure.
 */

import { z } from "zod";
import {
  botRest,
  userAvatarUrl,
  type BotRestReader,
} from "#src/lib/discord/bot-rest.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("discord-resolve-users");

export const ResolvedDiscordUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  avatar: z.string().nullable(),
});
export type ResolvedDiscordUser = z.infer<typeof ResolvedDiscordUserSchema>;

/** Hard cap so a single call can't fan out to Discord unbounded. */
export const MAX_IDS_PER_RESOLVE = 100;

export type ResolveUsersDependencies = {
  readonly rest: BotRestReader;
};

function defaultDependencies(): ResolveUsersDependencies {
  return { rest: botRest() };
}

function fallback(id: string): ResolvedDiscordUser {
  return { id, username: id, displayName: id, avatar: null };
}

async function resolveOne(
  id: string,
  rest: BotRestReader,
): Promise<ResolvedDiscordUser> {
  try {
    const user = await rest.user(id);
    if (user === null) return fallback(id);
    return {
      id,
      username: user.username,
      displayName: user.global_name ?? user.username,
      avatar: userAvatarUrl(user),
    };
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
  dependencies: ResolveUsersDependencies = defaultDependencies(),
): Promise<Record<string, ResolvedDiscordUser>> {
  const unique = [...new Set(ids)].slice(0, MAX_IDS_PER_RESOLVE);
  const resolved = await Promise.all(
    unique.map((id) => resolveOne(id, dependencies.rest)),
  );
  return Object.fromEntries(resolved.map((user) => [user.id, user]));
}
