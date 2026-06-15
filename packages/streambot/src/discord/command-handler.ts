import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import {
  LoopModeSchema,
  type PlaybackEvent,
} from "@shepherdjerred/streambot/machine/types.ts";
import {
  isHttpUrl,
  resolvePlayQuery,
} from "@shepherdjerred/streambot/discord/resolve.ts";
import {
  canControlItem,
  isAdmin,
} from "@shepherdjerred/streambot/discord/permissions.ts";
import {
  formatTimecode,
  parseTimecode,
} from "@shepherdjerred/streambot/discord/timecode.ts";
import {
  helpText,
  sourcesPages,
  type SourcesPages,
} from "@shepherdjerred/streambot/discord/help-text.ts";
import {
  sourceLabel,
  type Source,
  type SubtitlePref,
} from "@shepherdjerred/streambot/sources/source.ts";
import type { Chapter } from "@shepherdjerred/streambot/sources/chapters.ts";
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
import type { UserId } from "@shepherdjerred/streambot/types/ids.ts";

const MAX_LIST = 20;
const PLAYLIST_TIMEOUT_MS = 60_000;
const SOURCES_TIMEOUT_MS = 15_000;

/**
 * Build a per-request subtitle preference from the `subtitles` (on/off) and `sublang` options.
 * Returns undefined when neither is set, so the source falls back to the server's subtitle config.
 */
export function buildSubtitlePref(
  subtitles: string | null,
  sublang: string | null,
): SubtitlePref | undefined {
  const enabled = subtitles === null ? undefined : subtitles === "on";
  const trimmed = sublang?.trim() ?? "";
  const language = trimmed.length > 0 ? trimmed : undefined;
  if (enabled === undefined && language === undefined) return undefined;
  return {
    ...(enabled === undefined ? {} : { enabled }),
    ...(language === undefined ? {} : { language }),
  };
}

/** Attach a subtitle preference to a resolved source, preserving its discriminant. */
function withSubtitles(
  source: Source,
  subtitles: SubtitlePref | undefined,
): Source {
  switch (source.kind) {
    case "file":
      return { ...source, subtitles };
    case "url":
      return { ...source, subtitles };
    case "search":
      return { ...source, subtitles };
  }
}

/** A short " _(subtitles: …)_" suffix for the ephemeral ack, or "" when no override was given. */
function subtitlesSuffix(pref: SubtitlePref | undefined): string {
  if (pref?.enabled === false) return " _(subtitles: off)_";
  if (pref?.enabled === true) {
    return pref.language === undefined
      ? " _(subtitles: on)_"
      : ` _(subtitles: ${pref.language})_`;
  }
  if (pref?.language !== undefined) return ` _(subtitles: ${pref.language})_`;
  return "";
}

export type QueueItemView = {
  readonly title: string;
  readonly requesterId: UserId;
  /** Chapter markers of this item (only populated for the currently-playing item). */
  readonly chapters: readonly Chapter[];
};
export type PlaybackView = {
  readonly state: string;
  readonly current: QueueItemView | null;
  readonly queue: readonly QueueItemView[];
  readonly loop: string;
  readonly volume: number;
};

/**
 * The minimal slash-interaction surface the handler needs — decoupled from discord.js so the
 * command logic can be unit-tested with a fake. `command-bot.ts` adapts a real
 * `ChatInputCommandInteraction` to this. Every reply is ephemeral (acks to the invoker); public
 * output is posted separately by the status reporter.
 */
export type CommandInteraction = {
  readonly userId: UserId;
  subcommand: () => string;
  getString: (name: string) => string | null;
  getStringRequired: (name: string) => string;
  getIntegerRequired: (name: string) => number;
  /** Ephemeral ack to the invoker. */
  reply: (content: string) => Promise<void>;
  /** Defer (ephemeral) for a slow op, then `editReply`. */
  defer: () => Promise<void>;
  editReply: (content: string) => Promise<void>;
  /**
   * Edit the deferred reply to show page 1 and attach Prev/Next/First/Last buttons (when
   * `pages.length > 1`); the adapter drives the collector so handlers stay discord.js-free.
   * For a single-page result, this just edits in the one message with no buttons.
   */
  replyPaginated: (payload: SourcesPages) => Promise<void>;
};

export type CommandHandlerDeps = {
  readonly config: Config;
  readonly dispatch: (event: PlaybackEvent) => void;
  readonly view: () => PlaybackView;
  readonly library: () => readonly LibraryEntry[];
  /** Apply volume to the live stream; resolves false when nothing is playing. */
  readonly setVolume: (percent: number) => Promise<boolean>;
  /** Seek the live stream to an absolute offset (seconds); resolves false when nothing is playing. */
  readonly seek: (seconds: number) => Promise<boolean>;
  /** Expand a playlist URL into items (yt-dlp), adult-filtered. */
  readonly expandPlaylist: (
    url: string,
    signal: AbortSignal,
  ) => Promise<PlaylistItem[]>;
  /** List the source/site names yt-dlp supports (cached); backs `/stream sources`. */
  readonly listSources: (signal: AbortSignal) => Promise<readonly string[]>;
  /** Post a world-readable message to the status channel (shaming, etc.). */
  readonly announce: (message: string) => Promise<void>;
};

/**
 * Pure-ish command logic: routes a `/stream <subcommand>` interaction to the right machine event,
 * enforces permissions, and renders ephemeral acks. No discord.js dependency — fully unit-testable.
 */
export class CommandHandler {
  private readonly deps: CommandHandlerDeps;

  constructor(deps: CommandHandlerDeps) {
    this.deps = deps;
  }

  async run(interaction: CommandInteraction): Promise<void> {
    switch (interaction.subcommand()) {
      case "play":
        return this.handlePlay(interaction, false);
      case "playnext":
        return this.handlePlay(interaction, true);
      case "skip":
        return this.handleSkip(interaction);
      case "stop":
        return this.handleStop(interaction);
      case "queue":
        return interaction.reply(this.queueText());
      case "nowplaying":
        return interaction.reply(this.nowPlayingText());
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
      case "seek":
        return this.handleSeek(interaction);
      case "chapters":
        return interaction.reply(this.chaptersText());
      case "chapter":
        return this.handleChapter(interaction);
      case "list":
        return interaction.reply(
          this.listText(interaction.getString("filter")),
        );
      case "search":
        return interaction.reply(
          this.listText(interaction.getStringRequired("query")),
        );
      case "sources":
        return this.handleSources(interaction);
      case "help":
        return interaction.reply(helpText());
      default:
        return interaction.reply("Unknown command.");
    }
  }

  private async handlePlay(
    interaction: CommandInteraction,
    next: boolean,
  ): Promise<void> {
    const userId = interaction.userId;
    const query = interaction.getStringRequired("query");
    const subtitles = buildSubtitlePref(
      interaction.getString("subtitles"),
      interaction.getString("sublang"),
    );

    if (isHttpUrl(query) && isLikelyPlaylist(query)) {
      await interaction.defer();
      const items = await this.deps.expandPlaylist(
        query,
        AbortSignal.timeout(PLAYLIST_TIMEOUT_MS),
      );
      for (const item of items) {
        const source = { kind: "url", url: item.url, subtitles } as const;
        this.deps.dispatch({
          type: next ? "ADD_NEXT" : "ADD",
          source,
          requesterId: userId,
        });
      }
      await interaction.editReply(
        `Queued ${String(items.length)} item(s) from the playlist.${subtitlesSuffix(subtitles)}`,
      );
      return;
    }

    const source = withSubtitles(
      resolvePlayQuery(query, this.deps.library()),
      subtitles,
    );
    if (isBlockedSource(source)) {
      await this.deps.announce(shameMessage(userId));
      await interaction.reply("🚫 Nope.");
      return;
    }
    this.deps.dispatch({
      type: next ? "ADD_NEXT" : "ADD",
      source,
      requesterId: userId,
    });
    await interaction.reply(
      `${next ? "Up next" : "Queued"}: **${sourceLabel(source)}**${subtitlesSuffix(subtitles)}`,
    );
  }

  private async handleSources(interaction: CommandInteraction): Promise<void> {
    const query = interaction.getString("query");
    // Listing extractors shells out to yt-dlp (and loads every extractor), so defer first.
    await interaction.defer();
    const sources = await this.deps.listSources(
      AbortSignal.timeout(SOURCES_TIMEOUT_MS),
    );
    await interaction.replyPaginated(sourcesPages(sources, query));
  }

  private async handleSkip(interaction: CommandInteraction): Promise<void> {
    if (
      !canControlItem(
        interaction.userId,
        this.deps.view().current?.requesterId ?? null,
        this.deps.config.discord.adminIds,
      )
    ) {
      await interaction.reply("Only the requester or an admin can skip this.");
      return;
    }
    this.deps.dispatch({ type: "SKIP" });
    await interaction.reply("⏭️ Skipped.");
  }

  private async handleStop(interaction: CommandInteraction): Promise<void> {
    if (!isAdmin(interaction.userId, this.deps.config.discord.adminIds)) {
      await interaction.reply("Only an admin can stop playback.");
      return;
    }
    this.deps.dispatch({ type: "STOP" });
    await interaction.reply("⏹️ Stopped and cleared the queue.");
  }

  private async handleRemove(interaction: CommandInteraction): Promise<void> {
    const index = interaction.getIntegerRequired("index");
    const item = this.deps.view().queue[index - 1];
    if (item === undefined) {
      await interaction.reply(`There's no item at position ${String(index)}.`);
      return;
    }
    if (
      !canControlItem(
        interaction.userId,
        item.requesterId,
        this.deps.config.discord.adminIds,
      )
    ) {
      await interaction.reply(
        "Only the requester or an admin can remove this.",
      );
      return;
    }
    this.deps.dispatch({ type: "REMOVE", index });
    await interaction.reply(`Removed **${item.title}**.`);
  }

  private async handleClear(interaction: CommandInteraction): Promise<void> {
    if (!isAdmin(interaction.userId, this.deps.config.discord.adminIds)) {
      await interaction.reply("Only an admin can clear the queue.");
      return;
    }
    const count = this.deps.view().queue.length;
    this.deps.dispatch({ type: "CLEAR" });
    await interaction.reply(`Cleared ${String(count)} item(s).`);
  }

  private async handleMove(interaction: CommandInteraction): Promise<void> {
    const from = interaction.getIntegerRequired("from");
    const to = interaction.getIntegerRequired("to");
    this.deps.dispatch({ type: "MOVE", from, to });
    await interaction.reply(`Moved item ${String(from)} → ${String(to)}.`);
  }

  private async handleShuffle(interaction: CommandInteraction): Promise<void> {
    const count = this.deps.view().queue.length;
    this.deps.dispatch({ type: "SHUFFLE" });
    await interaction.reply(`🔀 Shuffled ${String(count)} item(s).`);
  }

  private async handleLoop(interaction: CommandInteraction): Promise<void> {
    const parsed = LoopModeSchema.safeParse(
      interaction.getStringRequired("mode"),
    );
    if (!parsed.success) {
      await interaction.reply("Invalid loop mode.");
      return;
    }
    this.deps.dispatch({ type: "SET_LOOP", mode: parsed.data });
    await interaction.reply(`🔁 Loop: **${parsed.data}**.`);
  }

  private async handleVolume(interaction: CommandInteraction): Promise<void> {
    const level = interaction.getIntegerRequired("level");
    this.deps.dispatch({ type: "SET_VOLUME", volume: level });
    const applied = await this.deps.setVolume(level);
    await interaction.reply(
      applied
        ? `🔊 Volume → ${String(level)}%.`
        : `Volume set to ${String(level)}% for the next video.`,
    );
  }

  private async handleSeek(interaction: CommandInteraction): Promise<void> {
    const current = this.deps.view().current;
    if (current === null) {
      await interaction.reply("Nothing is playing.");
      return;
    }
    if (
      !canControlItem(
        interaction.userId,
        current.requesterId,
        this.deps.config.discord.adminIds,
      )
    ) {
      await interaction.reply("Only the requester or an admin can seek this.");
      return;
    }
    const seconds = parseTimecode(interaction.getStringRequired("position"));
    if (seconds === null) {
      await interaction.reply("Invalid timestamp. Try 90, 1:30, or 1:02:03.");
      return;
    }
    const applied = await this.deps.seek(seconds);
    await interaction.reply(
      applied
        ? `⏩ Seeked to ${formatTimecode(seconds)}.`
        : "Nothing is playing.",
    );
  }

  private async handleChapter(interaction: CommandInteraction): Promise<void> {
    const current = this.deps.view().current;
    if (current === null) {
      await interaction.reply("Nothing is playing.");
      return;
    }
    if (
      !canControlItem(
        interaction.userId,
        current.requesterId,
        this.deps.config.discord.adminIds,
      )
    ) {
      await interaction.reply("Only the requester or an admin can seek this.");
      return;
    }
    const number = interaction.getIntegerRequired("number");
    const chapter = current.chapters[number - 1];
    if (chapter === undefined) {
      await interaction.reply(
        current.chapters.length === 0
          ? "No chapters for the current video."
          : `There's no chapter ${String(number)}. This video has ${String(current.chapters.length)}.`,
      );
      return;
    }
    const applied = await this.deps.seek(chapter.startSeconds);
    await interaction.reply(
      applied
        ? `⏩ Chapter ${String(chapter.index)}: **${chapter.title}** (${formatTimecode(chapter.startSeconds)}).`
        : "Nothing is playing.",
    );
  }

  private chaptersText(): string {
    const current = this.deps.view().current;
    if (current === null) {
      return "Nothing is playing.";
    }
    if (current.chapters.length === 0) {
      return "No chapters for the current video.";
    }
    const lines = current.chapters.map(
      (chapter) =>
        `${String(chapter.index)}. \`${formatTimecode(chapter.startSeconds)}\` — ${chapter.title}`,
    );
    return `**Chapters for ${current.title}:**\n${lines.join("\n")}`;
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
