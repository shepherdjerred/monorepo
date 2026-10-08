import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  LabelBuilder,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  type Interaction,
  type MessageCreateOptions,
} from "discord.js";
import type { z } from "zod";
import { createLogger } from "#src/logger.ts";
import { TRPCError } from "@trpc/server";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { acceptSupportMessage } from "#src/support/conversations.ts";
import { SupportContextSchema } from "#src/support/context.ts";
import { wakeSupportJobs } from "#src/support/jobs.ts";
import { getFeedbackUrl } from "#src/discord/utils/feedback.ts";
import { recordSupportTouchpoint } from "#src/support/measurement.ts";
import { isScoutOperator } from "#src/operations/operator-allowlist.ts";

const logger = createLogger("support-interactions");

export function supportContactRow(matchId?: RiotMatchId) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Secondary)
      .setLabel(matchId === undefined ? "Contact Scout" : "Feedback / help")
      .setCustomId(`support:contact:${matchId ?? ""}`),
  );
}

/** Passive product control, not an additional outreach message. Freeze before sending. */
export async function withSupportAction(
  message: MessageCreateOptions,
  matchId: RiotMatchId,
  serverId: string,
): Promise<MessageCreateOptions> {
  if (
    !(await isPolicyEnabled("scout_support_conversations_enabled")) ||
    !(await isPolicyEnabled("scout_support_report_action_enabled", {
      server: DiscordGuildIdSchema.parse(serverId),
    }))
  )
    return message;
  const components = [...(message.components ?? [])];
  if (components.length >= 5) return message;
  return {
    ...message,
    components: [...components, supportContactRow(matchId)],
  };
}

export function buildSupportModal(matchId?: RiotMatchId) {
  const input = new TextInputBuilder()
    .setCustomId("message")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(4000);
  const label = new LabelBuilder()
    .setLabel(
      matchId === undefined
        ? "How can Scout help?"
        : "What happened or was confusing?",
    )
    .setTextInputComponent(input);
  return new ModalBuilder()
    .setCustomId(`support:message:${matchId ?? ""}`)
    .setTitle("Contact Scout privately")
    .addLabelComponents(label);
}

async function showSupportModal(
  interaction: ButtonInteraction,
  matchId: RiotMatchId | undefined,
): Promise<void> {
  await interaction.showModal(buildSupportModal(matchId));
  if (isScoutOperator(interaction.user.id)) return;
  try {
    await recordSupportTouchpoint(
      `opened:${interaction.id}`,
      matchId === undefined ? "HELP" : "REPORT",
      "OPENED",
    );
  } catch {
    logger.warn("Support modal opened but its measurement was unavailable");
  }
}

async function submitSupportModal(
  interaction: ModalSubmitInteraction,
  context: z.infer<typeof SupportContextSchema>,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const body = interaction.fields.getTextInputValue("message").trim();
    if (body.length === 0 || body.length > 4000)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Write a message of up to 4,000 characters.",
      });
    await acceptSupportMessage({
      discordId: interaction.user.id,
      username: interaction.user.username,
      body,
      source: "DISCORD_MODAL",
      discordMessageId: interaction.id,
      context,
    });
  } catch (error) {
    await interaction.editReply(
      error instanceof TRPCError
        ? error.message
        : "Your message could not be saved. Please try again.",
    );
    if (!(error instanceof TRPCError)) throw error;
    return;
  }
  await wakeSupportJobs();
  // A failed Discord acknowledgement must never falsely say the committed message was lost.
  await interaction.editReply(
    `Saved in Scout's private support inbox. This is an automatic receipt; a person may reply. Read replies or add screenshots at ${getFeedbackUrl()}, or DM Scout.`,
  );
}

export async function handleSupportInteraction(
  interaction: Interaction,
): Promise<boolean> {
  if (!interaction.isButton() && !interaction.isModalSubmit()) return false;
  if (!interaction.customId.startsWith("support:")) return false;
  if (!(await isPolicyEnabled("scout_support_conversations_enabled"))) {
    await interaction.reply({
      content: `Use the private web form: ${getFeedbackUrl()}`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  const [, action, matchId = ""] = interaction.customId.split(":");
  const context = SupportContextSchema.parse({
    ...(matchId === "" ? {} : { matchId }),
    ...(interaction.guildId === null ? {} : { serverId: interaction.guildId }),
  });
  if (action === "contact" && interaction.isButton()) {
    await showSupportModal(interaction, context.matchId);
    return true;
  }
  if (action === "message" && interaction.isModalSubmit()) {
    await submitSupportModal(interaction, context);
    return true;
  }
  throw new Error("Unknown support interaction");
}
