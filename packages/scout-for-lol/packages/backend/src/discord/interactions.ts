import { MessageFlags, type Client, type Interaction } from "discord.js";
import { captureBucksMemberActivity } from "#src/analytics/bryan-bucks.ts";
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
import {
  isParlayCustomId,
  parseParlayCustomId,
} from "#src/betting/parlay-custom-id.ts";
import { handleParlayBetButton } from "#src/betting/parlay-bet-button.ts";
import {
  isWeeklyParlayCustomId,
  parseWeeklyParlayCustomId,
} from "#src/betting/weekly-parlay-custom-id.ts";
import { handleWeeklyParlayBetButton } from "#src/betting/weekly-parlay-bet-button.ts";
import {
  isDareCustomId,
  parseDareCustomId,
} from "#src/betting/dare-custom-id.ts";
import {
  handleDareButton,
  type DareButtonInteraction,
} from "#src/betting/dare-discord.ts";
import {
  handleDareV2Button,
  type DareV2ButtonInteraction,
} from "#src/betting/dare-discord-v2.ts";
import {
  isDareV2CustomId,
  parseDareV2CustomId,
} from "#src/betting/dare-custom-id-v2.ts";
import { createLogger } from "#src/logger.ts";
import { discordComponentsTotal } from "#src/metrics/index.ts";
import {
  handleScoutPublishButton,
  type ScoutPublishButtonInteraction,
} from "#src/discord/scout/publish.ts";
import {
  isScoutCustomId,
  parseScoutPublishCustomId,
} from "#src/discord/scout/custom-id.ts";

const logger = createLogger("discord-interactions");

async function captureButtonActivity(
  interaction: RoutableButtonInteraction,
  activityKind:
    "outcome_bet" | "parlay_bet" | "weekly_parlay_bet" | "navigation" | "dare",
  status: "success" | "error",
): Promise<void> {
  await captureBucksMemberActivity({
    serverId: interaction.guildId,
    discordId: interaction.user.id,
    activityKind,
    surface: "button",
    status,
  });
}

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
    // discord.js's ButtonInteraction structurally satisfies the router's
    // parameter type, so this passes the live object with no cast.
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
  BucksNavigationInteraction &
  ScoutPublishButtonInteraction &
  DareButtonInteraction &
  DareV2ButtonInteraction & {
    deferUpdate: () => Promise<unknown>;
    deferred: boolean;
    replied: boolean;
  };

async function routeWeeklyParlayButton(
  interaction: RoutableButtonInteraction,
): Promise<void> {
  try {
    if (parseWeeklyParlayCustomId(interaction.customId) === undefined) {
      discordComponentsTotal.inc({ namespace: "bbw", status: "malformed" });
      await interaction.deferUpdate();
      return;
    }
    await handleWeeklyParlayBetButton(interaction);
    await captureButtonActivity(interaction, "weekly_parlay_bet", "success");
    discordComponentsTotal.inc({ namespace: "bbw", status: "success" });
  } catch (error) {
    await captureButtonActivity(interaction, "weekly_parlay_bet", "error");
    logger.error("❌ Error handling a weekly Bryan Bucks button:", error);
    discordComponentsTotal.inc({ namespace: "bbw", status: "error" });
    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({
        content:
          "😵 Something went wrong placing that weekly parlay bet. Try again shortly.",
      });
    }
  }
}

async function routeDareButton(
  interaction: RoutableButtonInteraction,
): Promise<void> {
  try {
    if (parseDareCustomId(interaction.customId) === undefined) {
      discordComponentsTotal.inc({ namespace: "bbd", status: "malformed" });
      await interaction.deferUpdate();
      return;
    }
    await handleDareButton(interaction);
    await captureButtonActivity(interaction, "dare", "success");
    discordComponentsTotal.inc({ namespace: "bbd", status: "success" });
  } catch (error) {
    await captureButtonActivity(interaction, "dare", "error");
    logger.error("❌ Error handling a Bryan Bucks dare button:", error);
    discordComponentsTotal.inc({ namespace: "bbd", status: "error" });
    // The authorized path acknowledged with deferUpdate on the message the
    // button lives on, so editReply would clobber the public callout; a fresh
    // ephemeral message is the only safe apology.
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        content: "😵 Something went wrong with that dare. Try again shortly.",
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply({
      content: "😵 Something went wrong with that dare. Try again shortly.",
    });
  }
}

async function routeDareV2Button(
  interaction: RoutableButtonInteraction,
): Promise<void> {
  try {
    if (parseDareV2CustomId(interaction.customId) === undefined) {
      discordComponentsTotal.inc({ namespace: "bbd2", status: "malformed" });
      await interaction.deferUpdate();
      return;
    }
    await handleDareV2Button(interaction);
    await captureButtonActivity(interaction, "dare", "success");
    discordComponentsTotal.inc({ namespace: "bbd2", status: "success" });
  } catch (error) {
    await captureButtonActivity(interaction, "dare", "error");
    logger.error("Error handling a Bryan Bucks Dare v2 button:", error);
    discordComponentsTotal.inc({ namespace: "bbd2", status: "error" });
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
  if (isDareV2CustomId(interaction.customId)) {
    await routeDareV2Button(interaction);
    return;
  }
  if (isDareCustomId(interaction.customId)) {
    await routeDareButton(interaction);
    return;
  }
  if (isParlayCustomId(interaction.customId)) {
    try {
      if (parseParlayCustomId(interaction.customId) === undefined) {
        discordComponentsTotal.inc({ namespace: "bbp", status: "malformed" });
        await interaction.deferUpdate();
        return;
      }
      await handleParlayBetButton(interaction);
      await captureButtonActivity(interaction, "parlay_bet", "success");
      discordComponentsTotal.inc({ namespace: "bbp", status: "success" });
    } catch (error) {
      await captureButtonActivity(interaction, "parlay_bet", "error");
      logger.error("❌ Error handling a Bryan Bucks parlay button:", error);
      discordComponentsTotal.inc({ namespace: "bbp", status: "error" });
      if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({
          content:
            "😵 Something went wrong placing that parlay bet. Try again shortly.",
        });
      }
    }
    return;
  }
  if (isWeeklyParlayCustomId(interaction.customId)) {
    await routeWeeklyParlayButton(interaction);
    return;
  }
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
      await captureButtonActivity(interaction, "navigation", "success");
      discordComponentsTotal.inc({ namespace: "bbnav", status: "success" });
    } catch (error) {
      await captureButtonActivity(interaction, "navigation", "error");
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

  if (isScoutCustomId(interaction.customId)) {
    await routeScoutButton(interaction);
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
    await captureButtonActivity(interaction, "outcome_bet", "success");
    discordComponentsTotal.inc({ namespace: "bb", status: "success" });
  } catch (error) {
    await captureButtonActivity(interaction, "outcome_bet", "error");
    logger.error("❌ Error handling a Bryan Bucks button:", error);
    discordComponentsTotal.inc({ namespace: "bb", status: "error" });

    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({
        content: "😵 Something went wrong placing that bet. Try again shortly.",
      });
    }
  }
}

async function routeScoutButton(
  interaction: RoutableButtonInteraction,
): Promise<void> {
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
