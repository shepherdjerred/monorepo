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
import {
  ensureVoiceAssistantRuntime,
  type VoiceRuntimeStatus,
} from "#src/voice-assistant/runtime.ts";
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
  /**
   * Load the pipeline if this deployment can serve one. Called only after the
   * flag says yes, so a deployment nobody has enabled never pays for the
   * models.
   */
  resolveRuntime: () => Promise<VoiceRuntimeStatus>;
  manager: () => Pick<
    VoiceAssistantManager,
    "join" | "leave" | "isActive" | "activeChannelId" | "captureJoinEpoch"
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
  resolveRuntime: ensureVoiceAssistantRuntime,
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

  // Captured BEFORE the flag lookup below — the first async gate on the join
  // path — so a `/scout leave` that lands during that await (or the deferred
  // reply further down) is not invisible to the `join()` call at the end of
  // this function. See `captureJoinEpoch()`.
  const joinEpoch = manager.captureJoinEpoch(guildId.data);
  if (!(await dependencies.isVoiceEnabledForGuild(guildId.data))) {
    await replyPrivate(
      interaction,
      "The Hey Scout voice assistant is not enabled in this server.",
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
  // Everything above is cheap enough to answer inside Discord's three-second
  // acknowledgement window. Everything below is not, so acknowledge here and
  // edit from now on. The first join after a process start loads the voice
  // models — measured at ~1.6 s native and ~3.2 s WASM in the image smoke —
  // which on its own can exceed that window and turn a successful load into
  // "interaction failed". Establishing the connection afterwards can take
  // longer still (Ready waits up to 30 s). A failure past this point lands in
  // the dispatcher's deferred-error path.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const runtimeStatus = await dependencies.resolveRuntime();
  if (runtimeStatus === "unconfigured") {
    await interaction.editReply({
      content:
        "The Hey Scout voice assistant is not configured in this deployment yet.",
    });
    return;
  }
  if (runtimeStatus === "failed") {
    await interaction.editReply({
      content:
        "The Hey Scout voice assistant could not start. This has been logged; please try again shortly.",
    });
    return;
  }
  const outcome = await manager.join(guildId.data, channelId, joinEpoch);
  if (outcome === "cancelled") {
    // A leave/flag-disable/empty-channel-check/shutdown ended this guild's
    // session (or this very request, still queued) before Scout ever
    // started listening — the join never happened, so say so rather than
    // unconditionally claiming success.
    logger.info("voice assistant join was cancelled before it could start", {
      guildId: guildId.data,
      channelId,
    });
    await interaction.editReply({
      content:
        "Scout stopped joining because the session ended before it could start listening. Try /scout join again if you still want it.",
    });
    return;
  }
  logger.info("voice assistant joined by command", {
    guildId: guildId.data,
    channelId,
  });
  await interaction.editReply({
    content:
      'Scout joined your voice channel. Say "Hey Scout" followed by a question — for example, "Hey Scout, what does Cho\'Gath ult do at rank one?" I leave after 45 quiet minutes, when the channel empties, or on /scout leave.',
  });
}
