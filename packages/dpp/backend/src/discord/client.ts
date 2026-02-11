import { Client, GatewayIntentBits } from "discord.js";
import { logger } from "../logger.js";
import { getConfig } from "../config/index.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

if (getConfig().bot.enabled) {
  logger.info("discord bot is logging in");
  await client.login(getConfig().bot.discord_token);
  logger.info("discord bot is logged in");
} else {
  logger.info("discord bot is disabled");
}

export default client;
