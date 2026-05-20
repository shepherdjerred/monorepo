import {
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
} from "discord.js";
import { z } from "zod";
import { prisma } from "#src/database/index.ts";
import { grantPermission } from "#src/database/competition/permissions.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  PermissionTypeSchema,
} from "@scout-for-lol/data";
import { truncateDiscordMessage } from "#src/discord/utils/message.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("competition-grant-permission");

/**
 * Execute /competition grant-permission command
 * Allows server admins to grant competition creation permission to users
 */
export async function executeGrantPermission(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  // ============================================================================
  // Step 1: Check admin permissions
  // ============================================================================

  // Validate member permissions structure
  const PermissionsSchema = z.object({
    has: z.function(),
  });

  const permissionsResult = PermissionsSchema.safeParse(
    interaction.memberPermissions,
  );

  if (!permissionsResult.success || !interaction.memberPermissions) {
    await interaction.reply({
      content: truncateDiscordMessage("Unable to verify permissions"),
      ephemeral: true,
    });
    return;
  }

  const hasAdmin = interaction.memberPermissions.has(
    PermissionFlagsBits.Administrator,
  );

  if (!hasAdmin) {
    await interaction.reply({
      content: truncateDiscordMessage(
        "Only server administrators can grant permissions",
      ),
      ephemeral: true,
    });
    return;
  }

  // ============================================================================
  // Step 2: Extract and validate input
  // ============================================================================

  const targetUser = interaction.options.getUser("user", true);
  const serverId =
    interaction.guildId !== null && interaction.guildId.length > 0
      ? DiscordGuildIdSchema.parse(interaction.guildId)
      : null;

  if (!serverId) {
    await interaction.reply({
      content: truncateDiscordMessage(
        "This command can only be used in a server",
      ),
      ephemeral: true,
    });
    return;
  }

  const adminId = interaction.user.id;
  const permission = PermissionTypeSchema.parse(
    interaction.options.getString("permission") ?? "CREATE_COMPETITION",
  );

  // ============================================================================
  // Step 3: Grant permission in database
  // ============================================================================

  try {
    await grantPermission(prisma, {
      serverId,
      userId: DiscordAccountIdSchema.parse(targetUser.id),
      permission,
      grantedBy: DiscordAccountIdSchema.parse(adminId),
    });

    logger.info(
      `[Grant Permission] ${adminId} granted ${permission} to ${targetUser.id} on server ${serverId}`,
    );
  } catch (error) {
    logger.error(
      `[Grant Permission] Error granting permission to ${targetUser.id}:`,
      error,
    );
    await interaction.reply({
      content: truncateDiscordMessage(
        `Error granting permission: ${getErrorMessage(error)}`,
      ),
      ephemeral: true,
    });
    return;
  }

  // ============================================================================
  // Step 4: Send success message
  // ============================================================================

  await interaction.reply({
    content: truncateDiscordMessage(
      `✅ Granted **${permission}** permission to ${targetUser.username}.`,
    ),
    ephemeral: true,
  });
}
