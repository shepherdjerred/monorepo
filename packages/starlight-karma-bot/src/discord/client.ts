import Configuration from "#src/configuration.ts";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { autoMigrateLegacyKarma } from "#src/db/auto-migrate.ts";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.once(Events.ClientReady, (readyClient) => {
  console.warn(`[Discord] Bot logged in as ${readyClient.user.tag}`);
  console.warn(
    `[Discord] Connected to ${readyClient.guilds.cache.size.toString()} guild(s)`,
  );

  // Auto-migrate legacy karma records if needed
  void autoMigrateLegacyKarma();
});

console.warn("[Discord] Logging in to Discord...");
await client.login(Configuration.discordToken);

export default client;
