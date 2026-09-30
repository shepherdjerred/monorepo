/**
 * Make the shared Discord client usable over REST on a process that never logs
 * into the gateway.
 *
 * Around eighteen modules take the singleton in `discord/client.ts` and call
 * `channels.fetch`, `guilds.fetch` or `channel.send` on it. Every one of those
 * is an ordinary REST request that a gateway connection is not required for —
 * but discord.js only puts the bot token on `client.rest` inside `login()`, so
 * on a role that never logs in they all fail with "Expected token to be set for
 * this request, but none was present". This is that missing half: the token,
 * without the shard.
 *
 * The other half of gatewayless Discord work — identity — is handled by not
 * needing it. `client.user` is populated from the gateway's READY payload, so
 * the permission helpers take the bot's *id* instead, and a bot's user id is
 * its application id (the same equivalence `lib/discord/bot-rest.ts` relies
 * on). Nothing has to be fetched at boot to know it.
 */

import type { Client } from "discord.js";
import configuration from "#src/configuration.ts";
import { client } from "#src/discord/client.ts";

/**
 * Put the bot token on the client's REST manager.
 *
 * Safe on every role: `login()` sets the same token again, so a gateway-owning
 * process is unaffected by having had it set earlier. Deliberately not done at
 * import time — the module graph is loaded by tests and scripts that have no
 * real token, and this is a decision the composition root makes once.
 */
export function authorizeDiscordRest(target: Client = client): void {
  target.rest.setToken(configuration.discordToken);
}
