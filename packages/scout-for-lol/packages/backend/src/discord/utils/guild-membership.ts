/**
 * Guild membership helpers.
 */

import { client } from "#src/discord/client.ts";

/**
 * Snapshot of the guild ids the bot is currently a member of, for filtering work
 * (e.g. player polling) to live guilds only.
 *
 * Returns `undefined` when the client is not ready or its guild cache is empty,
 * so callers fall back to "no filter" rather than skipping all work during
 * startup or a Discord outage (when the cache is transiently empty).
 *
 * This is the one remaining gateway-cache read on the Activity path, and it is
 * deliberately left as one. On a role that owns no gateway it returns
 * `undefined` permanently, so polling widens to every account instead of the
 * live-guild subset: more work, never the wrong work. The obvious replacement —
 * the `GuildInstall` table — is not safe here, because that table is documented
 * as possibly missing rows for Scout's earliest guilds, and filtering by an
 * incomplete set would stop polling those guilds entirely. Authorization and
 * delivery decisions use `lib/discord/installed-guilds.ts`, which confirms a
 * negative against Discord; a polling filter cannot afford one REST call per
 * account, so it fails open instead.
 */
export function getActiveServerIds(): Set<string> | undefined {
  if (!client.isReady() || client.guilds.cache.size === 0) {
    return undefined;
  }
  return new Set(client.guilds.cache.keys());
}
