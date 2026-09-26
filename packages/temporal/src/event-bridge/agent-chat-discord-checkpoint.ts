import * as Sentry from "@sentry/bun";
import type { ChatInputCommandInteraction } from "discord.js";

const COMPONENT = "agent-chat-discord";

export function discordInteractionTimestamp(interactionId: string): string {
  const discordEpoch = 1_420_070_400_000n;
  return new Date(
    Number((BigInt(interactionId) >> 22n) + discordEpoch),
  ).toISOString();
}

export async function checkpointAcceptedDiscordCommand(input: {
  interaction: ChatInputCommandInteraction;
  operation: "new" | "continue";
  checkpoint: () => Promise<void>;
}): Promise<void> {
  try {
    await input.checkpoint();
  } catch (error: unknown) {
    Sentry.withScope((scope) => {
      scope.setTag("component", COMPONENT);
      scope.setTag("checkpoint", input.operation);
      scope.setContext("discordInteraction", {
        interactionId: input.interaction.id,
        channelId: input.interaction.channelId,
      });
      Sentry.captureException(error);
    });
    console.warn(
      JSON.stringify({
        level: "warning",
        msg: "Durable command accepted before catalog checkpoint",
        component: COMPONENT,
        interactionId: input.interaction.id,
        operation: input.operation,
      }),
    );
  }
}
