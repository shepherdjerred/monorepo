import {
  Client,
  GatewayIntentBits,
  Events,
  type Interaction,
} from "discord.js";
import type { Config } from "@shepherdjerred/sentinel/config/schema.ts";
import { logger } from "@shepherdjerred/sentinel/observability/logger.ts";
import { handleInteraction, registerCommands } from "./commands.ts";
import { handleButtonInteraction } from "./approvals.ts";

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

  client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    rest: {
      timeout: 30_000,
      retries: 3,
    },
  });

  client.once(Events.ClientReady, (readyClient) => {
    discordLogger.info(
      { user: readyClient.user.tag },
      "Discord client ready",
    );
    // Register slash commands after ready — client.application is guaranteed non-null here
    void registerCommands(readyClient, discordConfig.guildId);
  });

  client.on(Events.InteractionCreate, (interaction: Interaction) => {
    void handleInteractionSafe(interaction, config);
  });

  await client.login(discordConfig.token);
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
