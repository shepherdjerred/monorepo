import {
  MessageFlags,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
} from "discord.js";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import {
  getVoiceAssistantManager,
  type VoiceAssistantManager,
} from "#src/voice-assistant/manager.ts";
import { getVoiceAssistantRuntime } from "#src/voice-assistant/runtime.ts";
import { voiceManager } from "#src/voice/voice-manager.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("scout-voice-command");

/**
 * What `/scout join` and `/scout leave` need from a chat-input interaction.
 * Structural for the usual reason: discord.js's real interaction satisfies it,
 * and tests build a plain object.
 */
export type ScoutVoiceInteraction = {
  guildId: string | null;
  user: { id: string };
  reply: (options: InteractionReplyOptions) => Promise<unknown>;
  deferReply: (options: { flags: MessageFlags.Ephemeral }) => Promise<unknown>;
  editReply: (options: InteractionEditReplyOptions) => Promise<unknown>;
};

export type ScoutVoiceAction = "join" | "leave";

type ScoutVoiceDependencies = {
  isVoiceEnabledForGuild: (guildId: string) => Promise<boolean>;
  isRuntimeAvailable: () => boolean;
  manager: () => Pick<
    VoiceAssistantManager,
    "join" | "leave" | "isActive" | "activeChannelId"
  >;
  /** The requester's current voice channel in this guild, if any. */
  memberVoiceChannelId: (
    guildId: string,
    userId: string,
  ) => string | null | undefined;
};

const defaultDependencies: ScoutVoiceDependencies = {
  isVoiceEnabledForGuild: async (guildId) =>
    await isPolicyEnabled("voice_assistant_enabled", {
      server: DiscordGuildIdSchema.parse(guildId),
    }),
  isRuntimeAvailable: () => getVoiceAssistantRuntime() !== null,
  manager: getVoiceAssistantManager,
  memberVoiceChannelId: (guildId, userId) =>
    voiceManager
      .getClient()
      ?.guilds.cache.get(guildId)
      ?.voiceStates.cache.get(userId)?.channelId,
};

async function replyPrivate(
  interaction: ScoutVoiceInteraction,
  content: string,
): Promise<void> {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

/**
 * `/scout join` and `/scout leave`. Everything a speaker can get wrong —
 * wrong guild, flag off, deployment without voice, not in a voice channel —
 * is a user boundary and gets a plain ephemeral answer; only genuinely broken
 * plumbing propagates to the dispatcher's error reply.
 */
export async function executeScoutVoice(
  interaction: ScoutVoiceInteraction,
  action: ScoutVoiceAction,
  dependencies: ScoutVoiceDependencies = defaultDependencies,
): Promise<void> {
  if (interaction.guildId === null) {
    await replyPrivate(
      interaction,
      "Scout's voice assistant only works inside a server.",
    );
    return;
  }
  const guildId = DiscordGuildIdSchema.safeParse(interaction.guildId);
  if (!guildId.success) {
    await replyPrivate(
      interaction,
      "Scout's voice assistant only works inside a server.",
    );
    return;
  }
  const manager = dependencies.manager();
  // Leaving is processed before every enablement gate on purpose: it only
  // ever ENDS listening, and a speaker whose guild flag was just switched off
  // (or whose client still shows a cached command) must always be able to
  // stop an active session. Consent controls never sit behind feature gates.
  if (action === "leave") {
    const left = manager.leave(guildId.data);
    await replyPrivate(
      interaction,
      left
        ? "Scout left the voice channel. Say the word — well, type it — when you want me back."
        : "Scout is not in a voice channel in this server.",
    );
    return;
  }

  if (!(await dependencies.isVoiceEnabledForGuild(guildId.data))) {
    await replyPrivate(
      interaction,
      "The Hey Scout voice assistant is not enabled in this server.",
    );
    return;
  }
  if (!dependencies.isRuntimeAvailable()) {
    await replyPrivate(
      interaction,
      "The Hey Scout voice assistant is not switched on in this deployment yet.",
    );
    return;
  }

  const channelId = dependencies.memberVoiceChannelId(
    guildId.data,
    interaction.user.id,
  );
  if (channelId === null || channelId === undefined) {
    await replyPrivate(
      interaction,
      "Join a voice channel first, then use /scout join so I know where to listen.",
    );
    return;
  }
  if (manager.activeChannelId(guildId.data) === channelId) {
    await replyPrivate(
      interaction,
      'Scout is already listening in your channel. Say "Hey Scout" followed by a question.',
    );
    return;
  }
  // Establishing the voice connection can take longer than Discord's
  // interaction acknowledgement window (Ready waits up to 30 s), so
  // acknowledge first and edit the deferred reply after the join. A join
  // failure after this point lands in the dispatcher's deferred-error path.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await manager.join(guildId.data, channelId);
  logger.info("voice assistant joined by command", {
    guildId: guildId.data,
    channelId,
  });
  await interaction.editReply({
    content:
      'Scout joined your voice channel. Say "Hey Scout" followed by a question — for example, "Hey Scout, what does Cho\'Gath ult do at rank one?" I leave after 45 quiet minutes, when the channel empties, or on /scout leave.',
  });
}
