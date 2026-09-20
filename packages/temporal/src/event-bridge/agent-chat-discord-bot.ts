import * as Sentry from "@sentry/bun";
import type { Client as TemporalClient } from "@temporalio/client";
import {
  Client,
  Events,
  GatewayIntentBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  handleAgentChatDiscordCommand,
  registerAgentChatDiscordCommand,
} from "./agent-chat-discord.ts";

const COMPONENT = "agent-chat-discord";

export type AgentChatDiscordHandle = {
  close: () => Promise<void>;
};

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({ level, msg: message, component: COMPONENT, ...fields }),
  );
}

async function handleDiscordInteractionSafely(
  temporal: TemporalClient,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  try {
    await handleAgentChatDiscordCommand(temporal, interaction);
  } catch (error: unknown) {
    Sentry.captureException(error);
    jsonLog("error", "Unhandled Discord agent chat command failure", {
      interactionId: interaction.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function startAgentChatDiscordBot(
  temporal: TemporalClient,
  signal: AbortSignal = new AbortController().signal,
): Promise<AgentChatDiscordHandle | undefined> {
  const token = Bun.env["AGENT_CHAT_DISCORD_TOKEN"];
  if (token === undefined || token === "") {
    jsonLog(
      "warning",
      "AGENT_CHAT_DISCORD_TOKEN not set; skipping Discord ingress",
    );
    return undefined;
  }
  signal.throwIfAborted();
  const discord = new Client({ intents: [GatewayIntentBits.Guilds] });
  discord.on(Events.InteractionCreate, (interaction) => {
    if (interaction.isChatInputCommand()) {
      void handleDiscordInteractionSafely(temporal, interaction);
    }
  });
  const ready = new Promise<Client<true>>((resolve) => {
    discord.once(Events.ClientReady, resolve);
  });
  const abort = (): void => {
    void discord.destroy();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    await discord.login(token);
    const readyClient = await ready;
    await registerAgentChatDiscordCommand(readyClient.application);
  } catch (error: unknown) {
    await discord.destroy();
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
  }
  jsonLog("info", "Dedicated durable agent Discord ingress connected");
  return {
    async close() {
      await discord.destroy();
      jsonLog("info", "Dedicated durable agent Discord ingress stopped");
    },
  };
}
