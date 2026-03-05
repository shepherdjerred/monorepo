import {
  Client,
  GatewayIntentBits,
  Events,
  Partials,
  type Interaction,
} from "discord.js";
import type { Config } from "@shepherdjerred/sentinel/config/schema.ts";
import { logger } from "@shepherdjerred/sentinel/observability/logger.ts";
import { handleInteraction, registerCommands } from "./commands.ts";
import { handleButtonInteraction } from "./approvals.ts";
import { handleDirectMessage } from "./chat.ts";

const discordLogger = logger.child({ module: "discord" });

let client: Client | null = null;

export function getDiscordClient(): Client | null {
  return client;
}

export async function startDiscord(config: Config): Promise<void> {
  const discordConfig = config.discord;
  if (discordConfig == null) {
    discordLogger.warn("Discord config not provided, skipping Discord startup");
    return;
  }

  const newClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message],
    rest: {
      timeout: 30_000,
      retries: 3,
    },
  });

  newClient.once(Events.ClientReady, (readyClient) => {
    discordLogger.info({ user: readyClient.user.tag }, "Discord client ready");
    // Register slash commands after ready — client.application is guaranteed non-null here
    void registerCommands(readyClient, discordConfig.guildId);
  });

  newClient.on(Events.InteractionCreate, (interaction: Interaction) => {
    void handleInteractionSafe(interaction, config);
  });

  newClient.on(Events.MessageCreate, (message) => {
    if (message.author.bot) return;
    if (message.guild != null) return; // Only handle DMs
    void handleDirectMessage(message);
  });

  // Only set the module-level client after successful login
  await newClient.login(discordConfig.token);
  client = newClient;
}

async function handleInteractionSafe(
  interaction: Interaction,
  config: Config,
): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      await handleInteraction(interaction, config);
    } else if (interaction.isButton()) {
      await handleButtonInteraction(interaction, config);
    }
  } catch (error: unknown) {
    discordLogger.error(error, "Error handling Discord interaction");
  }
}

export async function stopDiscord(): Promise<void> {
  if (client != null) {
    await client.destroy();
    client = null;
    discordLogger.info("Discord client destroyed");
  }
}
