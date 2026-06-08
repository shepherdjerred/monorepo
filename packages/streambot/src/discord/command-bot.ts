import {
  type ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
  type VoiceState,
} from "discord.js";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import {
  CommandHandler,
  type CommandInteraction,
} from "@shepherdjerred/streambot/discord/command-handler.ts";
import { commandJson } from "@shepherdjerred/streambot/discord/commands.ts";
import type { SessionManager } from "@shepherdjerred/streambot/session/session-manager.ts";
import { EMPTY_HANDLE } from "@shepherdjerred/streambot/session/session-manager.ts";
import type { LibraryEntry } from "@shepherdjerred/streambot/sources/library.ts";
import type { PlaylistItem } from "@shepherdjerred/streambot/sources/ytdlp.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  toUserId,
  type ChannelId,
} from "@shepherdjerred/streambot/types/ids.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("command-bot");
// Grace period before leaving an empty voice channel, so a brief solo moment or a reconnect
// blip doesn't drop playback (and an unattended e2e can stream to an empty channel).
const ALONE_GRACE_MS = 30_000;

/** Subcommands that start (or join) a session in the issuer's current voice channel. */
const PLAY_SUBCOMMANDS = new Set(["play", "playnext"]);
/** Subcommands that only read the media library — no session required. */
const LIBRARY_SUBCOMMANDS = new Set(["list", "search"]);

export type CommandBotDeps = {
  readonly config: Config;
  /** Lazily resolves the session manager (constructed after the bot to break the wiring cycle). */
  readonly getSessions: () => SessionManager;
  readonly library: () => readonly LibraryEntry[];
  readonly expandPlaylist: (
    url: string,
    signal: AbortSignal,
  ) => Promise<PlaylistItem[]>;
};

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

  /** Post a world-readable message to a text channel (now-playing, shaming, resume). No-op if null. */
  async announce(channelId: ChannelId | null, message: string): Promise<void> {
    if (channelId === null) {
      return;
    }
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel?.isSendable() === true) {
        await channel.send(message);
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
    } else if (LIBRARY_SUBCOMMANDS.has(sub)) {
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
      announce: (message) => this.announce(announceChannel, message),
    });
    await handler.run(this.adapt(interaction));
  }

  private onVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): void {
    const guildId = GuildIdSchema.safeParse(newState.guild.id);
    if (!guildId.success) {
      return;
    }
    const candidates = new Set<string>();
    if (oldState.channelId !== null) {
      candidates.add(oldState.channelId);
    }
    if (newState.channelId !== null) {
      candidates.add(newState.channelId);
    }
    for (const raw of candidates) {
      const channelId = ChannelIdSchema.safeParse(raw);
      if (!channelId.success) {
        continue;
      }
      const meta = this.deps
        .getSessions()
        .activeSessionByChannel(guildId.data, channelId.data);
      if (meta === null) {
        continue;
      }
      this.evaluateChannelOccupancy(
        guildId.data,
        channelId.data,
        newState,
        meta.userId,
      );
    }
  }

  private evaluateChannelOccupancy(
    guildId: ReturnType<typeof GuildIdSchema.parse>,
    channelId: ChannelId,
    state: VoiceState,
    streamerId: string | null,
  ): void {
    const channel = state.guild.channels.cache.get(channelId);
    if (channel?.isVoiceBased() !== true) {
      return;
    }
    const humans = channel.members.filter(
      (member) => !member.user.bot && member.id !== streamerId,
    );
    const key = `${guildId}:${channelId}`;
    if (humans.size > 0) {
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
      await (interaction.replied || interaction.deferred
        ? interaction.followUp({
            content: message,
            flags: MessageFlags.Ephemeral,
          })
        : interaction.reply({
            content: message,
            flags: MessageFlags.Ephemeral,
          }));
    }
  }
}
