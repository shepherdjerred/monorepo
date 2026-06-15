import type { ChatInputCommandInteraction } from "discord.js";
import {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import type { PooledUserbot } from "@shepherdjerred/discord-stream-lifecycle/pool/pooled-userbot.ts";
import type { SingleSlotSessionManager } from "@shepherdjerred/discord-stream-lifecycle/session/session-manager.ts";

export type StopPermissionMode =
  /** Anyone in the guild can stop the active session (default). */
  | "anyMember"
  /** Only the user who ran `/play` can stop. Anyone else gets an ephemeral error. */
  | "onlyStarter";

/** Builds the `/stop` slash command JSON for `REST.put(Routes.applicationCommands(...))`. */
export function buildStopCommand(params: {
  readonly description?: string;
}): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName("stop")
    .setDescription(
      params.description ?? "Stop the active game and free the streaming bot.",
    )
    .setContexts(InteractionContextType.Guild);
}

/**
 * Handle a `/stop` slash interaction by tearing down the active session for the
 * caller's guild (if any). No-op if idle. Honors the permission mode for who can stop.
 */
export async function handleStopCommand<TUserbot extends PooledUserbot>(
  interaction: ChatInputCommandInteraction,
  sessionManager: SingleSlotSessionManager<TUserbot>,
  options: { readonly permissionMode?: StopPermissionMode } = {},
): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "`/stop` must be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const session = sessionManager.getActiveSessionForGuild(interaction.guildId);
  if (session === null) {
    await interaction.reply({
      content: `No ${sessionManager.driverName()} session is active in this server.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const permissionMode = options.permissionMode ?? "anyMember";
  if (
    permissionMode === "onlyStarter" &&
    session.startedByUserId !== interaction.user.id
  ) {
    await interaction.reply({
      content: `Only <@${session.startedByUserId}> (who ran \`/play\`) can stop this session.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferReply();
  await sessionManager.stop("userStop");
  await interaction.editReply({
    content: `${sessionManager.driverName()} stopped. Save flushed.`,
  });
}
