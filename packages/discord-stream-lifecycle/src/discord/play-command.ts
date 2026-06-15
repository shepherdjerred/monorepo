import type { ChatInputCommandInteraction } from "discord.js";
import {
  GuildMember,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import type { PooledUserbot } from "@shepherdjerred/discord-stream-lifecycle/pool/pooled-userbot.ts";
import type { SingleSlotSessionManager } from "@shepherdjerred/discord-stream-lifecycle/session/session-manager.ts";

/** Builds the `/play` slash command JSON for `REST.put(Routes.applicationCommands(...))`. */
export function buildPlayCommand(params: {
  /** Override the default description; defaults to `Start <game> in your voice channel.`. */
  readonly description?: string;
}): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName("play")
    .setDescription(
      params.description ?? "Start the game in your voice channel.",
    )
    .setContexts(InteractionContextType.Guild);
}

/**
 * Handle a `/play` slash interaction by acquiring a userbot and asking the session
 * manager to start a session in the caller's current voice channel, bound to the text
 * channel the interaction was sent in.
 */
export async function handlePlayCommand<TUserbot extends PooledUserbot>(
  interaction: ChatInputCommandInteraction,
  sessionManager: SingleSlotSessionManager<TUserbot>,
): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "`/play` must be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const member = interaction.member;
  if (!(member instanceof GuildMember)) {
    await interaction.reply({
      content: "Couldn't read your voice state — try again in a moment.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const voiceChannelId = member.voice.channelId;
  if (voiceChannelId === null) {
    await interaction.reply({
      content: "Join a voice channel first, then run `/play` again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const textChannelId = interaction.channelId;
  await interaction.deferReply();
  const result = await sessionManager.start({
    guildId: interaction.guildId,
    voiceChannelId,
    textChannelId,
    startedByUserId: interaction.user.id,
  });
  switch (result.kind) {
    case "started": {
      await interaction.editReply({
        content: sessionManager.buildWelcomeMessage(result.session),
      });
      return;
    }
    case "alreadyActive": {
      const where =
        result.active.guildId === interaction.guildId
          ? `<#${result.active.voiceChannelId}> in this server`
          : "another server";
      await interaction.editReply({
        content: `${sessionManager.driverName()} is currently active in ${where}. Try again later.`,
      });
      return;
    }
    case "noUserbotAvailable": {
      await interaction.editReply({
        content:
          "No streaming bots are available for this server right now. Try again later.",
      });
      return;
    }
    case "driverError": {
      await interaction.editReply({
        content: `Failed to start ${sessionManager.driverName()}: ${result.error.message}`,
      });
      return;
    }
  }
}
