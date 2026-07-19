import {
  type ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  type MessageCreateOptions,
  MessageFlags,
  REST,
  Routes,
  type VoiceState,
} from "discord.js";
import { countRealViewers } from "@shepherdjerred/discord-stream-lifecycle/viewer-presence";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import type { Announcement } from "@shepherdjerred/streambot/discord/status-reporter.ts";
import {
  CommandHandler,
  type CommandInteraction,
} from "@shepherdjerred/streambot/discord/command-handler.ts";
import { sendPaginatedReply } from "@shepherdjerred/streambot/discord/pagination.ts";
import { sendSubtitleMenu } from "@shepherdjerred/streambot/discord/subtitle-menu.ts";
import { commandJson } from "@shepherdjerred/streambot/discord/commands.ts";
import type { SessionManager } from "@shepherdjerred/streambot/session/session-manager.ts";
import { EMPTY_HANDLE } from "@shepherdjerred/streambot/session/session-types.ts";
import type { LibraryEntry } from "@shepherdjerred/streambot/sources/library.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import type { PlaylistItem } from "@shepherdjerred/streambot/sources/ytdlp.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  toUserId,
  type ChannelId,
  type GuildId,
} from "@shepherdjerred/streambot/types/ids.ts";
import {
  getErrorMessage,
  isStaleInteractionError,
} from "@shepherdjerred/streambot/util/errors.ts";
import * as Sentry from "@sentry/bun";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("command-bot");
// Grace period before leaving an empty voice channel, so a brief solo moment or a reconnect
// blip doesn't drop playback (and an unattended e2e can stream to an empty channel).
const ALONE_GRACE_MS = 30_000;

/** Subcommands that start (or join) a session in the issuer's current voice channel. */
const PLAY_SUBCOMMANDS = new Set(["play", "playnext"]);
/** Subcommands answerable without a playback session (library/yt-dlp lookups + static help). */
const STATELESS_SUBCOMMANDS = new Set(["list", "search", "sources", "help"]);

export type CommandBotDeps = {
  readonly config: Config;
  /** Lazily resolves the session manager (constructed after the bot to break the wiring cycle). */
  readonly getSessions: () => SessionManager;
  readonly library: () => readonly LibraryEntry[];
  readonly expandPlaylist: (
    url: string,
    signal: AbortSignal,
  ) => Promise<PlaylistItem[]>;
  readonly listSources: (signal: AbortSignal) => Promise<readonly string[]>;
  /** Synchronously pre-resolve a `/stream play` url/search source before acking (feature: fast error surfacing). */
  readonly resolvePlaySource: (
    source: Source,
    signal: AbortSignal,
  ) => Promise<ResolvedSource>;
};

/** Render a neutral {@link Announcement} into discord.js message options (text, optional poster embed). */
function toMessageOptions(message: Announcement): MessageCreateOptions {
  if (typeof message === "string") {
    return { content: message };
  }
  if (message.embed === undefined) {
    return { content: message.content };
  }
  const embed = new EmbedBuilder();
  if (message.embed.title !== undefined) {
    embed.setTitle(message.embed.title);
  }
  if (message.embed.imageUrl !== undefined) {
    embed.setImage(message.embed.imageUrl);
  }
  return { content: message.content, embeds: [embed] };
}

function parseVoiceChannelId(raw: string | null): ChannelId | null {
  if (raw === null) {
    return null;
  }
  const parsed = ChannelIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * The discord.js (bot-token) command bot. Registers global slash commands and routes each
 * interaction to the right per-`(guild, voice channel)` session via the {@link SessionManager}.
 */
export class CommandBot {
  private readonly client: Client;
  private readonly deps: CommandBotDeps;
  /** Pending "leave empty VC" timers, keyed by `guildId:channelId`. */
  private readonly aloneTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  /** Resolves once the bot is logged in and its slash commands are registered; rejects on failure. */
  readonly ready: Promise<void>;

  constructor(deps: CommandBotDeps) {
    this.deps = deps;
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    });
    this.ready = new Promise<void>((resolve, reject) => {
      this.client.once(Events.ClientReady, (ready) => {
        void this.registerThenSettle(ready.application.id, resolve, reject);
      });
    });
    this.client.on(Events.InteractionCreate, (interaction) => {
      if (interaction.isChatInputCommand()) {
        void this.safeHandle(interaction);
      }
    });
    this.client.on(Events.VoiceStateUpdate, (oldState, newState) => {
      this.onVoiceStateUpdate(oldState, newState);
    });
  }

  async login(): Promise<void> {
    await this.client.login(this.deps.config.discord.botToken);
    log.info("command bot logged in", {
      user: this.client.user?.username ?? null,
    });
  }

  async destroy(): Promise<void> {
    for (const timer of this.aloneTimers.values()) {
      clearTimeout(timer);
    }
    this.aloneTimers.clear();
    await this.client.destroy();
  }

  /** Post a world-readable announcement to a text channel (now-playing, shaming, resume). No-op if null. */
  async announce(
    channelId: ChannelId | null,
    message: Announcement,
  ): Promise<void> {
    if (channelId === null) {
      return;
    }
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel?.isSendable() === true) {
        await channel.send(toMessageOptions(message));
      }
    } catch (error) {
      log.warn("announce failed", { error: getErrorMessage(error) });
    }
  }

  private async registerThenSettle(
    applicationId: string,
    resolve: () => void,
    reject: (error: Error) => void,
  ): Promise<void> {
    try {
      await this.register(applicationId);
      resolve();
    } catch (error) {
      reject(
        error instanceof Error ? error : new Error(getErrorMessage(error)),
      );
    }
  }

  private async register(applicationId: string): Promise<void> {
    const rest = new REST().setToken(this.deps.config.discord.botToken);
    // Global registration: the commands work in every server the bot is invited to (the pool decides
    // which of those it can actually stream into).
    await rest.put(Routes.applicationCommands(applicationId), {
      body: commandJson,
    });
    log.info("slash commands registered", { count: commandJson.length });
    // Pre-pool deploys registered guild-scoped commands. Discord stores guild and global commands
    // in separate buckets and a PUT to one never clears the other, so a leftover guild-scoped copy
    // shows up as a duplicate /stream in the picker. Empty every guild bucket the bot can see.
    for (const guildId of this.client.guilds.cache.keys()) {
      await rest.put(Routes.applicationGuildCommands(applicationId, guildId), {
        body: [],
      });
    }
    log.info("stale guild-scoped commands cleared", {
      guilds: this.client.guilds.cache.size,
    });
  }

  /** Voice channel the issuer is currently in (for joining / addressing their session), or null. */
  private issuerVoiceChannel(
    interaction: ChatInputCommandInteraction,
  ): ChannelId | null {
    const channelId = interaction.guild?.voiceStates.cache.get(
      interaction.user.id,
    )?.channelId;
    if (channelId === null || channelId === undefined) {
      return null;
    }
    const parsed = ChannelIdSchema.safeParse(channelId);
    return parsed.success ? parsed.data : null;
  }

  private async route(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = GuildIdSchema.safeParse(interaction.guildId ?? "");
    if (!guildId.success) {
      await interaction.reply({
        content: "Use this command in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const sub = interaction.options.getSubcommand();
    const invoked = ChannelIdSchema.safeParse(interaction.channelId);
    const invokedChannel: ChannelId | null = invoked.success
      ? invoked.data
      : null;
    const sessions = this.deps.getSessions();

    let handle;
    let announceChannel: ChannelId | null = invokedChannel;
    if (PLAY_SUBCOMMANDS.has(sub)) {
      const voiceChannelId = this.issuerVoiceChannel(interaction);
      if (voiceChannelId === null) {
        await interaction.reply({
          content: "Join a voice channel first, then run `/stream play`.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const statusChannelId = invokedChannel ?? voiceChannelId;
      handle = sessions.ensureForPlay({
        guildId: guildId.data,
        voiceChannelId,
        statusChannelId,
      });
      if (handle === null) {
        await interaction.reply({
          content: "No stream bots are available right now — try again later.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      announceChannel = statusChannelId;
    } else if (STATELESS_SUBCOMMANDS.has(sub)) {
      handle = EMPTY_HANDLE;
    } else {
      const voiceChannelId = this.issuerVoiceChannel(interaction);
      handle =
        voiceChannelId === null
          ? null
          : sessions.getExisting(guildId.data, voiceChannelId);
      if (handle === null) {
        await interaction.reply({
          content: "Nothing is playing in your voice channel.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    const handler = new CommandHandler({
      config: this.deps.config,
      dispatch: handle.dispatch,
      view: handle.view,
      library: this.deps.library,
      setVolume: handle.setVolume,
      seek: handle.seek,
      expandPlaylist: this.deps.expandPlaylist,
      listSources: this.deps.listSources,
      resolvePlaySource: this.deps.resolvePlaySource,
      announce: (message) => this.announce(announceChannel, message),
      listSubtitleCandidates: handle.listSubtitleCandidates,
      currentSourceId: handle.currentSourceId,
      hasPendingSubtitleMenu: handle.hasPendingSubtitleMenu,
      claimSubtitleMenu: handle.claimSubtitleMenu,
      releaseSubtitleMenu: handle.releaseSubtitleMenu,
    });
    await handler.run(this.adapt(interaction));
  }

  private onVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): void {
    const guildId = GuildIdSchema.safeParse(newState.guild.id);
    if (!guildId.success) {
      return;
    }
    const oldChannelId = parseVoiceChannelId(oldState.channelId);
    const newChannelId = parseVoiceChannelId(newState.channelId);
    if (
      this.handleStreamerVoiceTopology(
        guildId.data,
        newState.id,
        oldChannelId,
        newChannelId,
      )
    ) {
      return;
    }

    const candidates = new Set<ChannelId>();
    if (oldChannelId !== null) {
      candidates.add(oldChannelId);
    }
    if (newChannelId !== null) {
      candidates.add(newChannelId);
    }
    for (const channelId of candidates) {
      const meta = this.deps
        .getSessions()
        .activeSessionByChannel(guildId.data, channelId);
      if (meta === null) {
        continue;
      }
      this.evaluateChannelOccupancy(
        guildId.data,
        channelId,
        newState,
        meta.userId,
      );
    }
  }

  private handleStreamerVoiceTopology(
    guildId: GuildId,
    userId: string,
    oldChannelId: ChannelId | null,
    newChannelId: ChannelId | null,
  ): boolean {
    const sessions = this.deps.getSessions();
    const oldMeta =
      oldChannelId === null
        ? null
        : sessions.activeSessionByChannel(guildId, oldChannelId);
    const newMeta =
      newChannelId === null
        ? null
        : sessions.activeSessionByChannel(guildId, newChannelId);
    if (oldMeta?.userId !== userId && newMeta?.userId !== userId) {
      return false;
    }

    if (
      oldChannelId !== null &&
      newChannelId !== null &&
      oldChannelId !== newChannelId
    ) {
      // Clearing the source timer is always safe: this session is leaving oldChannelId (and on a
      // collision it gets torn down). The destination timer must only be cleared on a SUCCESSFUL
      // move — if moveSession returns false because newChannelId already hosts a different session,
      // clearing its timer would strand that surviving session (alone but never leaving).
      this.clearAloneTimer(`${guildId}:${oldChannelId}`);
      const moved = sessions.moveSession({
        guildId,
        fromChannelId: oldChannelId,
        toChannelId: newChannelId,
      });
      if (moved) {
        this.clearAloneTimer(`${guildId}:${newChannelId}`);
      }
      return true;
    }

    if (oldChannelId !== null && newChannelId === null) {
      this.clearAloneTimer(`${guildId}:${oldChannelId}`);
      log.warn("streamer voice state went null — notifying session manager", {
        guildId,
        channelId: oldChannelId,
      });
      // The session manager classifies the loss (kick vs transient) via the voice ws close code
      // and decides whether to stay down or reconnect-with-resume.
      sessions.notifyStreamerDetached({ guildId, channelId: oldChannelId });
      return true;
    }

    if (newChannelId !== null) {
      this.clearAloneTimer(`${guildId}:${newChannelId}`);
    }
    return true;
  }

  private evaluateChannelOccupancy(
    guildId: GuildId,
    channelId: ChannelId,
    state: VoiceState,
    streamerId: string | null,
  ): void {
    const channel = state.guild.channels.cache.get(channelId);
    if (channel?.isVoiceBased() !== true) {
      return;
    }
    const voiceStates = channel.guild.voiceStates.cache;
    const humanCount = countRealViewers(
      channel.members.map((member) => {
        const memberState = voiceStates.get(member.id);
        return {
          id: member.id,
          isBot: member.user.bot,
          streaming: memberState?.streaming ?? false,
          selfDeaf: memberState?.selfDeaf ?? false,
          selfMute: memberState?.selfMute ?? false,
        };
      }),
      {
        selfUserId: streamerId,
        peerUserbotIds: this.deps.config.discord.peerUserbotIds,
      },
    );
    const key = `${guildId}:${channelId}`;
    if (humanCount > 0) {
      this.clearAloneTimer(key);
      return;
    }
    if (this.aloneTimers.has(key)) {
      return;
    }
    // Alone in the VC. Leave after a grace period (cancelled if a human (re)joins), rather than
    // dropping playback the instant the channel empties.
    const timer = setTimeout(() => {
      this.aloneTimers.delete(key);
      log.info("voice channel empty for grace period — stopping", {
        guildId,
        channelId,
      });
      this.deps
        .getSessions()
        .getExisting(guildId, channelId)
        ?.dispatch({ type: "STOP" });
    }, ALONE_GRACE_MS);
    this.aloneTimers.set(key, timer);
  }

  private clearAloneTimer(key: string): void {
    const timer = this.aloneTimers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.aloneTimers.delete(key);
    }
  }

  /** Adapt a discord.js interaction to the handler's minimal, testable surface. */
  private adapt(interaction: ChatInputCommandInteraction): CommandInteraction {
    return {
      userId: toUserId(interaction.user.id),
      subcommand: () => interaction.options.getSubcommand(),
      getString: (name) => interaction.options.getString(name),
      getStringRequired: (name) => interaction.options.getString(name, true),
      getIntegerRequired: (name) => interaction.options.getInteger(name, true),
      reply: async (content) => {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      },
      defer: async () => {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      },
      editReply: async (content) => {
        await interaction.editReply(content);
      },
      replyPaginated: async (payload) => {
        await sendPaginatedReply(interaction, payload);
      },
      replySelectMenu: (candidates) =>
        sendSubtitleMenu(interaction, candidates),
    };
  }

  private async safeHandle(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    try {
      await this.route(interaction);
    } catch (error) {
      log.error("command handling failed", {
        command: interaction.commandName,
        error: getErrorMessage(error),
      });
      const message = "Something went wrong handling that command.";
      // This ack is best-effort: `replied`/`deferred` only flip after a
      // *successful* ack, so when the original reply was delivered but its
      // REST call rejected, this branch double-acks (40060). safeHandle is
      // dispatched fire-and-forget, so anything thrown here becomes an
      // unhandled rejection — handle every outcome explicitly instead.
      try {
        await (interaction.replied || interaction.deferred
          ? interaction.followUp({
              content: message,
              flags: MessageFlags.Ephemeral,
            })
          : interaction.reply({
              content: message,
              flags: MessageFlags.Ephemeral,
            }));
      } catch (ackError) {
        if (isStaleInteractionError(ackError)) {
          log.warn("error ack skipped: interaction stale", {
            command: interaction.commandName,
            error: getErrorMessage(ackError),
          });
        } else {
          log.error("error ack failed", {
            command: interaction.commandName,
            error: getErrorMessage(ackError),
          });
          Sentry.captureException(ackError);
        }
      }
    }
  }
}
