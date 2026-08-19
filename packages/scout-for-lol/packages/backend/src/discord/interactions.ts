import type { Client, Interaction } from "discord.js";
import { handleChatInputCommand } from "#src/discord/commands/index.ts";
import {
  handleBetButton,
  type BetButtonInteraction,
} from "#src/betting/bet-button.ts";
import { isBucksCustomId, parseBucksCustomId } from "#src/betting/custom-id.ts";
import {
  handleBucksNavigation,
  isBucksNavigationId,
  parseBucksNavigationId,
  type BucksNavigationInteraction,
} from "#src/betting/navigation.ts";
import { createLogger } from "#src/logger.ts";
import { discordComponentsTotal } from "#src/metrics/index.ts";

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
    void routeInteraction(interaction);
  });
}

async function routeInteraction(interaction: Interaction): Promise<void> {
  if (interaction.isButton()) {
    await routeButton(interaction);
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
export type RoutableButtonInteraction = BetButtonInteraction &
  BucksNavigationInteraction & {
    deferred: boolean;
    replied: boolean;
  };

export async function routeButton(
  interaction: RoutableButtonInteraction,
): Promise<void> {
  if (isBucksNavigationId(interaction.customId)) {
    try {
      if (parseBucksNavigationId(interaction.customId) === undefined) {
        discordComponentsTotal.inc({
          namespace: "bbnav",
          status: "malformed",
        });
        await interaction.deferUpdate();
        return;
      }

      await handleBucksNavigation(interaction);
      discordComponentsTotal.inc({ namespace: "bbnav", status: "success" });
    } catch (error) {
      logger.error("❌ Error handling Bryan Bucks navigation:", error);
      discordComponentsTotal.inc({ namespace: "bbnav", status: "error" });
      if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({
          content:
            "😵 Something went wrong loading that page. Try again shortly.",
          components: [],
        });
      }
    }
    return;
  }

  if (!isBucksCustomId(interaction.customId)) {
    // Some other feature's component. Not ours to answer, and Discord shows the
    // clicker nothing for a component no handler claims.
    discordComponentsTotal.inc({ namespace: "unknown", status: "ignored" });
    return;
  }

  try {
    if (parseBucksCustomId(interaction.customId) === undefined) {
      // Claimed by namespace but not a valid v1 ID — a stale button from an
      // older encoding, or someone poking the API. `isBucksCustomId` is only a
      // prefix check, so the routing decision is already made and simply
      // returning would leave the interaction unacknowledged: Discord then
      // shows the clicker "This interaction failed", which is a worse answer
      // than silence.
      //
      // `deferUpdate` is the silent acknowledgement — the message is left
      // exactly as it was and no reply appears — which keeps the handler's
      // deliberate "a stray component is not an error worth reporting" stance
      // while still closing the interaction out. It is counted as `malformed`
      // rather than folded into `success`, so the metric cannot report a
      // handled bet that never happened.
      discordComponentsTotal.inc({ namespace: "bb", status: "malformed" });
      await interaction.deferUpdate();
      return;
    }

    // discord.js's ButtonInteraction structurally satisfies the handler's
    // parameter type, so this passes the real object with no cast.
    await handleBetButton(interaction);
    discordComponentsTotal.inc({ namespace: "bb", status: "success" });
  } catch (error) {
    logger.error("❌ Error handling a Bryan Bucks button:", error);
    discordComponentsTotal.inc({ namespace: "bb", status: "error" });

    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({
        content: "😵 Something went wrong placing that bet. Try again shortly.",
      });
    }
  }
}
