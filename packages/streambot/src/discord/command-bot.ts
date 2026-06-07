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
  LoopModeSchema,
  type PlaybackEvent,
} from "@shepherdjerred/streambot/machine/types.ts";
import { commandJson } from "@shepherdjerred/streambot/discord/commands.ts";
import {
  isHttpUrl,
  resolvePlayQuery,
} from "@shepherdjerred/streambot/discord/resolve.ts";
import {
  canControlItem,
  isAdmin,
} from "@shepherdjerred/streambot/discord/permissions.ts";
import { sourceLabel } from "@shepherdjerred/streambot/sources/source.ts";
import {
  searchLibrary,
  type LibraryEntry,
} from "@shepherdjerred/streambot/sources/library.ts";
import {
  isLikelyPlaylist,
  type PlaylistItem,
} from "@shepherdjerred/streambot/sources/ytdlp.ts";
import {
  isBlockedSource,
  shameMessage,
} from "@shepherdjerred/streambot/moderation/adult-block.ts";
import { toUserId, type UserId } from "@shepherdjerred/streambot/types/ids.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("command-bot");
const MAX_LIST = 20;
const PLAYLIST_TIMEOUT_MS = 60_000;

export type QueueItemView = {
  readonly title: string;
  readonly requesterId: UserId;
};
export type PlaybackView = {
  readonly state: string;
  readonly current: QueueItemView | null;
  readonly queue: readonly QueueItemView[];
  readonly loop: string;
  readonly volume: number;
};

export type CommandBotDeps = {
  readonly config: Config;
  readonly dispatch: (event: PlaybackEvent) => void;
  readonly view: () => PlaybackView;
  readonly library: () => readonly LibraryEntry[];
  /** Apply volume to the live stream; resolves false when nothing is playing. */
  readonly setVolume: (percent: number) => Promise<boolean>;
  /** Expand a playlist URL into items (yt-dlp), adult-filtered. */
  readonly expandPlaylist: (
    url: string,
    signal: AbortSignal,
  ) => Promise<PlaylistItem[]>;
  /** Discord user id of the streamer selfbot, to exclude it from the "alone in VC" check. */
  readonly streamerUserId: () => string | null;
};

/** The discord.js (bot-token) command bot. Registers + handles slash commands in any channel. */
export class CommandBot {
  private readonly client: Client;
  private readonly deps: CommandBotDeps;

  constructor(deps: CommandBotDeps) {
    this.deps = deps;
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    });
    this.client.once(Events.ClientReady, (ready) => {
      void this.register(ready.application.id);
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
    await this.client.destroy();
  }

  /** Post a world-readable message to the configured status channel (used by the status reporter). */
  async announce(message: string): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(
        this.deps.config.discord.statusChannelId,
      );
      if (channel?.isSendable() === true) {
        await channel.send(message);
      }
    } catch (error) {
      log.warn("announce failed", { error: getErrorMessage(error) });
    }
  }

  private async register(applicationId: string): Promise<void> {
    const rest = new REST().setToken(this.deps.config.discord.botToken);
    await rest.put(
      Routes.applicationGuildCommands(
        applicationId,
        this.deps.config.discord.guildId,
      ),
      {
        body: commandJson,
      },
    );
    log.info("slash commands registered", { count: commandJson.length });
  }

  private onVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): void {
    const videoChannelId = this.deps.config.discord.videoChannelId;
    if (
      oldState.channelId !== videoChannelId &&
      newState.channelId !== videoChannelId
    ) {
      return;
    }
    const channel = newState.guild.channels.cache.get(videoChannelId);
    if (channel?.isVoiceBased() !== true) {
      return;
    }
    const streamerId = this.deps.streamerUserId();
    const humans = channel.members.filter(
      (member) => !member.user.bot && member.id !== streamerId,
    );
    if (humans.size === 0) {
      log.info("voice channel empty — stopping");
      this.deps.dispatch({ type: "STOP" });
    }
  }

  private async safeHandle(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    try {
      await this.handle(interaction);
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

  private ephemeral(
    interaction: ChatInputCommandInteraction,
    content: string,
  ): Promise<unknown> {
    return interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }

  private async handle(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    // Single `/stream` command; the action is the subcommand (`/stream play`, `/stream skip`, …).
    switch (interaction.options.getSubcommand()) {
      case "play":
        return this.handlePlay(interaction, false);
      case "playnext":
        return this.handlePlay(interaction, true);
      case "skip":
        return this.handleSkip(interaction);
      case "stop":
        return this.handleStop(interaction);
      case "queue":
        return this.ephemeralVoid(interaction, this.queueText());
      case "nowplaying":
        return this.ephemeralVoid(interaction, this.nowPlayingText());
      case "remove":
        return this.handleRemove(interaction);
      case "clear":
        return this.handleClear(interaction);
      case "move":
        return this.handleMove(interaction);
      case "shuffle":
        return this.handleShuffle(interaction);
      case "loop":
        return this.handleLoop(interaction);
      case "volume":
        return this.handleVolume(interaction);
      case "list":
        return this.ephemeralVoid(
          interaction,
          this.listText(interaction.options.getString("filter")),
        );
      case "search":
        return this.ephemeralVoid(
          interaction,
          this.listText(interaction.options.getString("query")),
        );
      default:
        return this.ephemeralVoid(interaction, "Unknown command.");
    }
  }

  private async ephemeralVoid(
    interaction: ChatInputCommandInteraction,
    content: string,
  ): Promise<void> {
    await this.ephemeral(interaction, content);
  }

  private async handlePlay(
    interaction: ChatInputCommandInteraction,
    next: boolean,
  ): Promise<void> {
    const userId = toUserId(interaction.user.id);
    const query = interaction.options.getString("query", true);

    if (isHttpUrl(query) && isLikelyPlaylist(query)) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const items = await this.deps.expandPlaylist(
        query,
        AbortSignal.timeout(PLAYLIST_TIMEOUT_MS),
      );
      for (const item of items) {
        const source = { kind: "url", url: item.url } as const;
        this.deps.dispatch({
          type: next ? "ADD_NEXT" : "ADD",
          source,
          requesterId: userId,
        });
      }
      await interaction.editReply(
        `Queued ${String(items.length)} item(s) from the playlist.`,
      );
      return;
    }

    const source = resolvePlayQuery(query, this.deps.library());
    if (isBlockedSource(source)) {
      await this.announce(shameMessage(userId));
      await this.ephemeral(interaction, "🚫 Nope.");
      return;
    }
    this.deps.dispatch({
      type: next ? "ADD_NEXT" : "ADD",
      source,
      requesterId: userId,
    });
    await this.ephemeral(
      interaction,
      `${next ? "Up next" : "Queued"}: **${sourceLabel(source)}**`,
    );
  }

  private async handleSkip(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const userId = toUserId(interaction.user.id);
    if (
      !canControlItem(
        userId,
        this.deps.view().current?.requesterId ?? null,
        this.deps.config.discord.adminIds,
      )
    ) {
      await this.ephemeral(
        interaction,
        "Only the requester or an admin can skip this.",
      );
      return;
    }
    this.deps.dispatch({ type: "SKIP" });
    await this.ephemeral(interaction, "⏭️ Skipped.");
  }

  private async handleStop(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    if (
      !isAdmin(toUserId(interaction.user.id), this.deps.config.discord.adminIds)
    ) {
      await this.ephemeral(interaction, "Only an admin can stop playback.");
      return;
    }
    this.deps.dispatch({ type: "STOP" });
    await this.ephemeral(interaction, "⏹️ Stopped and cleared the queue.");
  }

  private async handleRemove(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const userId = toUserId(interaction.user.id);
    const index = interaction.options.getInteger("index", true);
    const item = this.deps.view().queue[index - 1];
    if (item === undefined) {
      await this.ephemeral(
        interaction,
        `There's no item at position ${String(index)}.`,
      );
      return;
    }
    if (
      !canControlItem(
        userId,
        item.requesterId,
        this.deps.config.discord.adminIds,
      )
    ) {
      await this.ephemeral(
        interaction,
        "Only the requester or an admin can remove this.",
      );
      return;
    }
    this.deps.dispatch({ type: "REMOVE", index });
    await this.ephemeral(interaction, `Removed **${item.title}**.`);
  }

  private async handleClear(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    if (
      !isAdmin(toUserId(interaction.user.id), this.deps.config.discord.adminIds)
    ) {
      await this.ephemeral(interaction, "Only an admin can clear the queue.");
      return;
    }
    const count = this.deps.view().queue.length;
    this.deps.dispatch({ type: "CLEAR" });
    await this.ephemeral(interaction, `Cleared ${String(count)} item(s).`);
  }

  private async handleMove(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const from = interaction.options.getInteger("from", true);
    const to = interaction.options.getInteger("to", true);
    this.deps.dispatch({ type: "MOVE", from, to });
    await this.ephemeral(
      interaction,
      `Moved item ${String(from)} → ${String(to)}.`,
    );
  }

  private async handleShuffle(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const count = this.deps.view().queue.length;
    this.deps.dispatch({ type: "SHUFFLE" });
    await this.ephemeral(interaction, `🔀 Shuffled ${String(count)} item(s).`);
  }

  private async handleLoop(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const parsed = LoopModeSchema.safeParse(
      interaction.options.getString("mode", true),
    );
    if (!parsed.success) {
      await this.ephemeral(interaction, "Invalid loop mode.");
      return;
    }
    this.deps.dispatch({ type: "SET_LOOP", mode: parsed.data });
    await this.ephemeral(interaction, `🔁 Loop: **${parsed.data}**.`);
  }

  private async handleVolume(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const level = interaction.options.getInteger("level", true);
    this.deps.dispatch({ type: "SET_VOLUME", volume: level });
    const applied = await this.deps.setVolume(level);
    await this.ephemeral(
      interaction,
      applied
        ? `🔊 Volume → ${String(level)}%.`
        : `Volume set to ${String(level)}% for the next video.`,
    );
  }

  private nowPlayingText(): string {
    const view = this.deps.view();
    if (view.current === null) {
      return "Nothing is playing.";
    }
    return `**Now playing:** ${view.current.title} (requested by <@${view.current.requesterId}>)\n**Loop:** ${view.loop} · **Volume:** ${String(view.volume)}%`;
  }

  private queueText(): string {
    const view = this.deps.view();
    const lines: string[] = [];
    if (view.current !== null) {
      lines.push(`**Now:** ${view.current.title}`);
    }
    view.queue.slice(0, MAX_LIST).forEach((item, index) => {
      lines.push(
        `${String(index + 1)}. ${item.title} (<@${item.requesterId}>)`,
      );
    });
    if (view.queue.length > MAX_LIST) {
      lines.push(`…and ${String(view.queue.length - MAX_LIST)} more`);
    }
    return lines.length === 0 ? "The queue is empty." : lines.join("\n");
  }

  private listText(query: string | null): string {
    const entries = this.deps.library();
    const matched =
      query === null ? entries : searchLibrary(entries, query, MAX_LIST);
    if (matched.length === 0) {
      return query === null
        ? "The library is empty."
        : `No matches for \`${query}\`.`;
    }
    const lines = matched
      .slice(0, MAX_LIST)
      .map(
        (entry, index) =>
          `${String(index + 1)}. \`${entry.title}\` _(${entry.library})_`,
      );
    const suffix =
      matched.length > MAX_LIST
        ? `\n…and ${String(matched.length - MAX_LIST)} more`
        : "";
    return `**${String(matched.length)} result(s):**\n${lines.join("\n")}${suffix}`;
  }
}
