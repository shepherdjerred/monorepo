import Configuration from "../configuration.ts";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { autoMigrateLegacyKarma } from "../db/auto-migrate.ts";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`[Discord] Bot logged in as ${readyClient.user.tag}`);
  console.log(`[Discord] Connected to ${readyClient.guilds.cache.size.toString()} guild(s)`);

  // Auto-migrate legacy karma records if needed
  void autoMigrateLegacyKarma();
});

console.log("[Discord] Logging in to Discord...");
await client.login(Configuration.discordToken);

export default client;
