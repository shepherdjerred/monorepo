/**
 * Guild membership helpers.
 */

import { client } from "#src/discord/client.ts";

/**
 * Exact connected-guild snapshot for authorization decisions.
 *
 * Unlike {@link getActiveServerIds}, an empty ready cache is a known empty set.
 * Only an unready client returns undefined, which lets authorization fail as
 * unavailable instead of widening access.
 */
export function getConnectedServerIds(): Set<string> | undefined {
  if (!client.isReady()) {
    return undefined;
  }
  return new Set(client.guilds.cache.keys());
}

/**
 * Snapshot of the guild ids the bot is currently a member of, for filtering work
 * (e.g. player polling) to live guilds only.
 *
 * Returns `undefined` when the client is not ready or its guild cache is empty,
 * so callers fall back to "no filter" rather than skipping all work during
 * startup or a Discord outage (when the cache is transiently empty).
 */
export function getActiveServerIds(): Set<string> | undefined {
  if (!client.isReady() || client.guilds.cache.size === 0) {
    return undefined;
  }
  return new Set(client.guilds.cache.keys());
}
