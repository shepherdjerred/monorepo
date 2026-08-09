import Configuration from "#src/configuration.ts";
import { Client, Events, GatewayIntentBits } from "discord.js";
import * as Sentry from "@sentry/bun";
import {
  markGatewayConnected,
  markGatewayDisconnected,
} from "#src/discord/gateway-state.ts";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
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
  console.error(`[Discord] Shard ${shardId.toString()} error:`, error);
  Sentry.captureException(error, {
    tags: { source: "discord-shard", shardId: shardId.toString() },
  });
});

client.on(Events.Error, (error) => {
  console.error("[Discord] Client error:", error);
  Sentry.captureException(error, { tags: { source: "discord-client" } });
});

console.warn("[Discord] Logging in to Discord...");
await client.login(Configuration.discordToken);

export default client;
