import Configuration from "#src/configuration.ts";
import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import * as Sentry from "@sentry/bun";
import {
  markGatewayConnected,
  markGatewayDisconnected,
} from "#src/discord/gateway-state.ts";

const client = new Client({
  // `GuildMessageReactions` is NOT a privileged intent — only `MessageContent`,
  // `GuildMembers`, and `GuildPresences` are. Reading message *text* (which a
  // `@user ++` syntax would need) stays out of reach; reacting does not.
  // `GuildVoiceStates` was requested but never used, so it is gone.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessageReactions],
  // Reactions on messages older than the client's cache arrive as partials and
  // are silently dropped without these. Most karma-worthy messages are old.
  partials: [Partials.Message, Partials.Reaction, Partials.User],
});

client.once(Events.ClientReady, (readyClient) => {
  console.warn(`[Discord] Bot logged in as ${readyClient.user.tag}`);
  console.warn(
    `[Discord] Connected to ${readyClient.guilds.cache.size.toString()} guild(s)`,
  );
});

// Gateway lifecycle drives the liveness probe. discord.js reconnects on its
// own, so these only record state — nothing here forces a restart directly.
client.on(Events.ShardReady, (shardId) => {
  console.warn(`[Discord] Shard ${shardId.toString()} ready`);
  markGatewayConnected();
});

client.on(Events.ShardResume, (shardId) => {
  console.warn(`[Discord] Shard ${shardId.toString()} resumed`);
  markGatewayConnected();
});

client.on(Events.ShardDisconnect, (event, shardId) => {
  console.error(
    `[Discord] Shard ${shardId.toString()} disconnected (code ${String(event.code)})`,
  );
  markGatewayDisconnected();
});

client.on(Events.ShardError, (error, shardId) => {
  console.error("[Discord] Shard error:", shardId, error);
  Sentry.captureException(error, {
    tags: { source: "discord-shard", shardId: shardId.toString() },
  });
});

client.on(Events.Error, (error) => {
  console.error("[Discord] Client error:", error);
  Sentry.captureException(error, { tags: { source: "discord-client" } });
});

/** Connect to the gateway.
 *
 *  Deliberately NOT called at module scope. Login is the slowest and most
 *  rate-limit-prone step of startup, and importing this module used to block
 *  on it — which meant the health server could not bind until Discord was up,
 *  so probes got connection-refused during exactly the window the startup
 *  budget exists to cover. `src/index.ts` binds the health port first, then
 *  calls this. */
export async function loginDiscord(): Promise<void> {
  console.warn("[Discord] Logging in to Discord...");
  await client.login(Configuration.discordToken);
}

export default client;
