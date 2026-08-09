import {
  type ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  type Guild,
  type Message,
  type MessageComponentInteraction,
  MessageFlags,
  type User,
} from "discord.js";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import { CommandHandler } from "@shepherdjerred/streambot/discord/command-handler.ts";
import {
  adaptCardInteraction,
  adaptCommandInteraction,
} from "@shepherdjerred/streambot/discord/interaction-adapters.ts";
import { registerGlobalCommands } from "@shepherdjerred/streambot/discord/command-registration.ts";
import { VoiceTopologyWatcher } from "@shepherdjerred/streambot/discord/voice-topology.ts";
import { PlayerCardMessenger } from "@shepherdjerred/streambot/discord/player-card-message.ts";
import {
  PlayerCardRouter,
  safeHandleCardInteraction,
} from "@shepherdjerred/streambot/discord/player-card-router.ts";
import type { SessionManager } from "@shepherdjerred/streambot/session/session-manager.ts";
import {
  EMPTY_HANDLE,
  type SessionHandle,
} from "@shepherdjerred/streambot/session/session-types.ts";
import type { LibraryEntry } from "@shepherdjerred/streambot/sources/library.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import type { PlaylistItem } from "@shepherdjerred/streambot/sources/ytdlp.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  type ChannelId,
} from "@shepherdjerred/streambot/types/ids.ts";
import {
  getErrorMessage,
  isStaleInteractionError,
} from "@shepherdjerred/streambot/util/errors.ts";
import * as Sentry from "@sentry/bun";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import {
  registerGatewayHealthListeners,
  registerTopologyListeners,
} from "@shepherdjerred/streambot/discord/client-events.ts";

const log = logger.child("command-bot");
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

/**
 * The discord.js (bot-token) command bot. Registers global slash commands and routes each
 * interaction to the right per-`(guild, voice channel)` session via the {@link SessionManager}.
 */
export class CommandBot {
  private readonly client: Client;
  private readonly deps: CommandBotDeps;
  /** Player-card Discord effects + the message → session routing table. Handed to SessionManager. */
  readonly cards: PlayerCardMessenger;
  private readonly cardRouter: PlayerCardRouter;
  /** Streamer-move / empty-channel handling for `voiceStateUpdate`. */
  private readonly voiceTopology: VoiceTopologyWatcher;
  /** Resolves once the bot is logged in and its slash commands are registered; rejects on failure. */
  readonly ready: Promise<void>;

  constructor(deps: CommandBotDeps) {
    this.deps = deps;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        // Non-privileged, and message *content* is deliberately not requested: the player card only
        // needs to know that messages are arriving beneath it, so it can re-post before the controls
        // scroll out of reach.
        GatewayIntentBits.GuildMessages,
      ],
    });
    this.cards = new PlayerCardMessenger(this.client);
    this.cardRouter = new PlayerCardRouter({
      config: deps.config,
      messenger: this.cards,
      sessionFor: (owner) =>
        this.deps
          .getSessions()
          .getExisting(owner.guildId, owner.voiceChannelId),
      refreshCard: (owner) => {
        this.deps
          .getSessions()
          .refreshCard(owner.guildId, owner.voiceChannelId);
      },
      voiceChannelOf: (interaction) =>
        this.voiceChannelOf(interaction.guild, interaction.user),
      openSubtitlePicker: (interaction, handle) =>
        this.openSubtitlePicker(interaction, handle),
    });
    this.voiceTopology = new VoiceTopologyWatcher({
      getSessions: () => this.deps.getSessions(),
      peerUserbotIds: deps.config.discord.peerUserbotIds,
    });
    this.ready = new Promise<void>((resolve, reject) => {
      this.client.once(Events.ClientReady, (ready) => {
        void this.registerThenSettle(ready.application.id, resolve, reject);
      });
    });
    this.client.on(Events.InteractionCreate, (interaction) => {
      if (interaction.isChatInputCommand()) {
        void this.safeHandle(interaction);
        return;
      }
      // Player-card controls. Ids outside the `sb:` namespace (pagination, the subtitle picker) are
      // driven by their own message-scoped collectors and are left untouched by the router.
      if (interaction.isMessageComponent()) {
        void safeHandleCardInteraction(this.cardRouter, interaction);
      }
    });
    this.client.on(Events.MessageCreate, (message: Message) => {
      this.onChannelMessage(message);
    });
    this.client.on(Events.VoiceStateUpdate, (oldState, newState) => {
      this.voiceTopology.handle(oldState, newState);
    });
    registerTopologyListeners(this.client, () => this.deps.getSessions());
    registerGatewayHealthListeners(this.client);
  }

  async login(): Promise<void> {
    await this.client.login(this.deps.config.discord.botToken);
    log.info("command bot logged in", {
      user: this.client.user?.username ?? null,
    });
  }

  async destroy(): Promise<void> {
    this.voiceTopology.clearAll();
    await this.client.destroy();
  }

  /** Post a world-readable notice to a text channel (shaming, crash, resume). No-op if null. */
  async announce(channelId: ChannelId | null, message: string): Promise<void> {
    if (channelId === null) {
      return;
    }
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel?.isSendable() === true) {
        await channel.send({ content: message });
      }
    } catch (error) {
      log.warn("announce failed", { error: getErrorMessage(error) });
    }
  }

  /**
   * Feed status-channel traffic to the player cards so they can re-post before scrolling out of
   * reach. Only the message id and channel are used — the bot does not request message content.
   */
  private onChannelMessage(message: Message): void {
    const channelId = ChannelIdSchema.safeParse(message.channelId);
    if (!channelId.success) {
      return;
    }
    // Never let a player card count as traffic burying another player card. Sessions sharing a
    // status channel each see every other session's card post, so counting them would let N cards
    // feed each other's thresholds into a self-sustaining delete/re-post loop (six cards at the
    // default threshold of 5; two at a threshold of 1). Ordinary bot notices — crash, stop reason —
    // do genuinely push cards down the channel, so those still count.
    if (this.cards.ownerOf(message.id) !== null) {
      return;
    }
    this.deps
      .getSessions()
      .notifyStatusChannelMessage(channelId.data, message.id);
  }

  private async registerThenSettle(
    applicationId: string,
    resolve: () => void,
    reject: (error: Error) => void,
  ): Promise<void> {
    try {
      await registerGlobalCommands(
        this.client,
        this.deps.config.discord.botToken,
        applicationId,
      );
      resolve();
    } catch (error) {
      reject(
        error instanceof Error ? error : new Error(getErrorMessage(error)),
      );
    }
  }

  /**
   * Voice channel a user is currently in (for joining / addressing their session), or null. Shared
   * by slash routing and the player card's "are you actually in the channel" permission gate.
   */
  private voiceChannelOf(guild: Guild | null, user: User): ChannelId | null {
    const channelId = guild?.voiceStates.cache.get(user.id)?.channelId;
    if (channelId === null || channelId === undefined) {
      return null;
    }
    const parsed = ChannelIdSchema.safeParse(channelId);
    return parsed.success ? parsed.data : null;
  }

  /** Voice channel the slash-command issuer is currently in, or null. */
  private issuerVoiceChannel(
    interaction: ChatInputCommandInteraction,
  ): ChannelId | null {
    return this.voiceChannelOf(interaction.guild, interaction.user);
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

    await this.buildHandler(handle, announceChannel).run(
      adaptCommandInteraction(interaction),
    );
  }

  private buildHandler(
    handle: SessionHandle,
    announceChannel: ChannelId | null,
  ): CommandHandler {
    return new CommandHandler({
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
  }

  /**
   * The card's 💬 Subtitles button, served by running the *real* `/stream subtitles` handler over
   * an adapted component interaction. Reusing the handler keeps the single-flight guard and the
   * "playback moved on while you were choosing" re-check in one place instead of forking them.
   */
  private async openSubtitlePicker(
    interaction: MessageComponentInteraction,
    handle: SessionHandle,
  ): Promise<void> {
    const invoked = ChannelIdSchema.safeParse(interaction.channelId);
    await this.buildHandler(handle, invoked.success ? invoked.data : null).run(
      adaptCardInteraction(interaction, "subtitles"),
    );
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
