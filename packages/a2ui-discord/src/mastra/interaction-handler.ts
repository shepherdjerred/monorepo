/**
 * Discord Interaction Handler for A2UI
 * Handles button clicks and routes them to the appropriate handler
 */

import type {
  Client,
  Interaction,
  ButtonInteraction,
} from "discord.js";
import { parseButtonInteraction } from "../renderer.js";
import { getSurfaceStore, type SurfaceAction } from "./surface-store.js";
import { getActionHandler } from "./tools.js";

/**
 * Handle a Discord button interaction
 */
async function handleButtonInteraction(
  interaction: ButtonInteraction
): Promise<void> {
  // Parse the custom_id to get action info
  const parsed = parseButtonInteraction(interaction.customId);

  if (!parsed) {
    await interaction.reply({
      content: "Invalid button interaction",
      ephemeral: true,
    });
    return;
  }

  const store = getSurfaceStore();
  const surface = store.get(parsed.surfaceId);

  // Build the action object
  const actionData: SurfaceAction = {
    surfaceId: parsed.surfaceId,
    componentId: parsed.componentId ?? "unknown",
    actionName: parsed.action,
    context: (parsed.context ?? {}) as Record<string, unknown>,
    userId: interaction.user.id,
    channelId: interaction.channelId,
    messageId: interaction.message.id,
  };

  // Acknowledge the interaction first
  await interaction.deferUpdate();

  // Call the surface-specific handler if available
  if (surface?.onAction) {
    try {
      await surface.onAction(actionData);
    } catch (error) {
      console.error("Surface action handler error:", error);
    }
  }

  // Also call the global handler if set
  const globalHandler = getActionHandler();
  if (globalHandler) {
    try {
      await globalHandler(actionData);
    } catch (error) {
      console.error("Global action handler error:", error);
    }
  }
}

/**
 * Set up the interaction handler on a Discord client
 */
export function setupInteractionHandler(client: Client): void {
  client.on("interactionCreate", (interaction: Interaction) => {
    // Only handle button interactions for A2UI
    if (!interaction.isButton()) {
      return;
    }

    // Check if this is an A2UI button by trying to parse the custom_id
    const parsed = parseButtonInteraction(interaction.customId);
    if (!parsed) {
      return; // Not an A2UI button, let other handlers deal with it
    }

    // Handle the interaction
    void handleButtonInteraction(interaction).catch((error: unknown) => {
      console.error("Failed to handle A2UI button interaction:", error);
    });
  });
}

/**
 * Create a middleware for handling A2UI interactions in an existing handler
 */
export function createInteractionMiddleware(): (
  interaction: Interaction
) => Promise<boolean> {
  return async (interaction: Interaction): Promise<boolean> => {
    if (!interaction.isButton()) {
      return false; // Not handled
    }

    const parsed = parseButtonInteraction(interaction.customId);
    if (!parsed) {
      return false; // Not an A2UI button
    }

    await handleButtonInteraction(interaction);
    return true; // Handled
  };
}

export type { SurfaceAction };
