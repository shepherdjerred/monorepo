import {
  isDareCustomId,
  parseDareCustomId,
} from "#src/dares/lifecycle/dare-custom-id.ts";
import type { DareButtonInteraction } from "#src/dares/presentation/dare-button-interaction.ts";
import { handleDareButton } from "#src/dares/presentation/dare-discord.ts";
import { handleChatInputCommand } from "#src/discord/commands/index.ts";
import {
  executeScoutFollowUp,
  type ScoutFollowUpInteraction,
} from "#src/discord/commands/scout.ts";
import {
  handleScoutCreateButton,
  type ScoutCreateButtonInteraction,
} from "#src/discord/scout/confirm-creation.ts";
import {
  isScoutCustomId,
  parseScoutCreateCustomId,
  parseScoutFollowUpCustomId,
  parseScoutPublishCustomId,
} from "#src/discord/scout/custom-id.ts";
import {
  handleScoutPublishButton,
  type ScoutPublishButtonInteraction,
} from "#src/discord/scout/publish.ts";
import { createLogger } from "#src/logger.ts";
import { discordComponentsTotal } from "#src/metrics/index.ts";
import {
  handleMvpVoteButton,
  type VoteButtonInteraction,
} from "#src/mvp-votes/button-handler.ts";
import { isVoteCustomId, parseVoteCustomId } from "#src/mvp-votes/custom-id.ts";
import {
  handleMvpVoteModal,
  type VoteModalInteraction,
} from "#src/mvp-votes/modal-handler.ts";
import {
  handleMvpVoteSelect,
  type VoteSelectInteraction,
} from "#src/mvp-votes/select-handler.ts";
import { handleSupportInteraction } from "#src/support/discord.ts";
import { MessageFlags, type Client, type Interaction } from "discord.js";

const logger = createLogger("discord-interactions");

/**
 * The single `interactionCreate` registration.
 *
 * Until this existed, `handleCommands` owned the event and early-returned on
 * anything that was not a chat-input command, so components were silently
 * dropped. Routing now lives here and commands keep their own module, which
 * stops the command dispatcher from growing a second responsibility.
 *
 * Components are matched by custom-ID namespace rather than by a switch, so a
 * future feature adds a branch here and nothing else has to change.
 */
export function handleInteractions(client: Client): void {
  logger.info("⚡ Setting up Discord interaction handlers");

  client.on("interactionCreate", (interaction) => {
    void routeInteractionSafely(interaction);
  });
}

async function routeInteractionSafely(interaction: Interaction): Promise<void> {
  try {
    await routeInteraction(interaction);
  } catch {
    // Do not log private modal contents or Discord error payloads.
    logger.error("Discord interaction failed", {
      interactionId: interaction.id,
    });
  }
}

async function routeInteraction(interaction: Interaction): Promise<void> {
  if (await handleSupportInteraction(interaction)) return;
  if (interaction.isButton()) {
    // discord.js's ButtonInteraction structurally satisfies the router's
    // parameter type, so this passes the live object with no cast.
    await routeButton(interaction);
    return;
  }
  if (interaction.isStringSelectMenu()) {
    await routeStringSelect(interaction);
    return;
  }
  if (interaction.isModalSubmit()) {
    await routeModalSubmit(interaction);
    return;
  }
  if (interaction.isChatInputCommand()) {
    await handleChatInputCommand(interaction);
  }
}

/**
 * What the router needs from a button click.
 *
 * Structural for the same reason `BetButtonInteraction` is: discord.js's real
 * `ButtonInteraction` satisfies it, so `routeInteraction` passes the live object
 * with no cast, and a test builds a plain one rather than reaching for the
 * `as`-based mock helpers.
 */
export type RoutableButtonInteraction = ScoutPublishButtonInteraction &
  ScoutFollowUpInteraction &
  ScoutCreateButtonInteraction &
  DareButtonInteraction &
  VoteButtonInteraction & {
    deferUpdate: () => Promise<unknown>;
    deferred: boolean;
    replied: boolean;
  };

export type RoutableSelectInteraction = VoteSelectInteraction & {
  deferUpdate: () => Promise<unknown>;
};

export type RoutableModalInteraction = VoteModalInteraction & {
  deferUpdate: () => Promise<unknown>;
  deferred: boolean;
  replied: boolean;
};

async function routeDareV2Button(
  interaction: RoutableButtonInteraction,
): Promise<void> {
  try {
    if (parseDareCustomId(interaction.customId) === undefined) {
      discordComponentsTotal.inc({ namespace: "dare", status: "malformed" });
      await interaction.deferUpdate();
      return;
    }
    await handleDareButton(interaction);
    discordComponentsTotal.inc({ namespace: "dare", status: "success" });
  } catch (error) {
    logger.error("Error handling a Dare button:", error);
    discordComponentsTotal.inc({ namespace: "dare", status: "error" });
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        content: "Something went wrong with that dare. Try again shortly.",
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply({
      content: "Something went wrong with that dare. Try again shortly.",
    });
  }
}

export async function routeButton(
  interaction: RoutableButtonInteraction,
): Promise<void> {
  if (isDareCustomId(interaction.customId)) {
    await routeDareV2Button(interaction);
    return;
  }
  if (isScoutCustomId(interaction.customId)) {
    await routeScoutButton(interaction);
    return;
  }
  if (isVoteCustomId(interaction.customId)) {
    await routeVoteButton(interaction);
    return;
  }
  discordComponentsTotal.inc({ namespace: "unknown", status: "ignored" });
  await interaction.deferUpdate();
}

async function routeVoteButton(
  interaction: RoutableButtonInteraction,
): Promise<void> {
  try {
    if (parseVoteCustomId(interaction.customId)?.kind !== "button") {
      discordComponentsTotal.inc({ namespace: "vote", status: "malformed" });
      await interaction.deferUpdate();
      return;
    }
    await handleMvpVoteButton(interaction);
    discordComponentsTotal.inc({ namespace: "vote", status: "success" });
  } catch (error) {
    logger.error("Error handling an MVP vote button:", error);
    discordComponentsTotal.inc({ namespace: "vote", status: "error" });
    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({
        content: "Something went wrong recording that vote. Try again shortly.",
      });
    }
  }
}

export async function routeStringSelect(
  interaction: RoutableSelectInteraction,
): Promise<void> {
  if (!isVoteCustomId(interaction.customId)) {
    discordComponentsTotal.inc({ namespace: "unknown", status: "ignored" });
    return;
  }
  try {
    if (parseVoteCustomId(interaction.customId)?.kind !== "select") {
      discordComponentsTotal.inc({ namespace: "vote", status: "malformed" });
      await interaction.deferUpdate();
      return;
    }
    await handleMvpVoteSelect(interaction);
    discordComponentsTotal.inc({ namespace: "vote", status: "success" });
  } catch (error) {
    logger.error("Error handling an MVP vote select:", error);
    discordComponentsTotal.inc({ namespace: "vote", status: "error" });
    await interaction.reply({
      content: "Something went wrong recording that vote. Try again shortly.",
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  }
}

export async function routeModalSubmit(
  interaction: RoutableModalInteraction,
): Promise<void> {
  if (!isVoteCustomId(interaction.customId)) {
    discordComponentsTotal.inc({ namespace: "unknown", status: "ignored" });
    return;
  }
  try {
    if (parseVoteCustomId(interaction.customId)?.kind !== "modal") {
      discordComponentsTotal.inc({ namespace: "vote", status: "malformed" });
      await interaction.deferUpdate();
      return;
    }
    await handleMvpVoteModal(interaction);
    discordComponentsTotal.inc({ namespace: "vote", status: "success" });
  } catch (error) {
    logger.error("Error handling an MVP vote modal:", error);
    discordComponentsTotal.inc({ namespace: "vote", status: "error" });
    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({
        content: "Something went wrong saving that reason. Try again shortly.",
      });
    }
  }
}

async function routeScoutFollowUp(
  interaction: RoutableButtonInteraction,
): Promise<void> {
  try {
    await executeScoutFollowUp(interaction);
    discordComponentsTotal.inc({ namespace: "scout", status: "success" });
  } catch (error) {
    logger.error("❌ Error answering a Scout follow-up:", error);
    discordComponentsTotal.inc({ namespace: "scout", status: "error" });
    if (interaction.deferred) {
      await interaction.editReply({
        content: "Scout could not answer that follow-up. Try the button again.",
        allowedMentions: { parse: [] },
      });
    }
  }
}

async function routeScoutCreate(
  interaction: RoutableButtonInteraction,
): Promise<void> {
  try {
    await handleScoutCreateButton(interaction);
    discordComponentsTotal.inc({ namespace: "scout", status: "success" });
  } catch (error) {
    logger.error("❌ Error confirming a Scout creation:", error);
    discordComponentsTotal.inc({ namespace: "scout", status: "error" });
    if (interaction.deferred) {
      await interaction.editReply({
        // The failure may have come after the creation committed (Discord
        // rejecting the reply), so this never claims nothing was created.
        // Pressing again is safe: a confirmed card replays its result.
        content:
          "Something went wrong confirming that. Press the button again to see whether it was created.",
        allowedMentions: { parse: [] },
      });
    }
  }
}

async function routeScoutButton(
  interaction: RoutableButtonInteraction,
): Promise<void> {
  if (parseScoutFollowUpCustomId(interaction.customId) !== undefined) {
    await routeScoutFollowUp(interaction);
    return;
  }
  if (parseScoutCreateCustomId(interaction.customId) !== undefined) {
    await routeScoutCreate(interaction);
    return;
  }
  try {
    const malformed =
      parseScoutPublishCustomId(interaction.customId) === undefined;
    await handleScoutPublishButton(interaction);
    discordComponentsTotal.inc({
      namespace: "scout",
      status: malformed ? "malformed" : "success",
    });
  } catch (error) {
    logger.error("❌ Error publishing a Scout answer:", error);
    discordComponentsTotal.inc({ namespace: "scout", status: "error" });
    await interaction.followUp({
      content:
        "Scout could not post that answer. The button is still available to retry.",
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }
}
