import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import {
  LoopModeSchema,
  type PlaybackEvent,
  type ResolvedSource,
} from "@shepherdjerred/streambot/machine/types.ts";
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
  listPages,
  sourcesPages,
  type PaginatedPages,
} from "@shepherdjerred/streambot/discord/help-text.ts";
import type {
  Source,
  SubtitlePref,
} from "@shepherdjerred/streambot/sources/source.ts";
import {
  chaptersText,
  nowPlayingText,
  queueText,
  type PlaybackView,
} from "@shepherdjerred/streambot/discord/queue-text.ts";
import { runPlayCommand } from "@shepherdjerred/streambot/discord/play-command.ts";
import { decodeTrackRef } from "@shepherdjerred/streambot/discord/subtitle-menu.ts";
import type { LibraryEntry } from "@shepherdjerred/streambot/sources/library.ts";
import type { PlaylistItem } from "@shepherdjerred/streambot/sources/ytdlp.ts";
import type { SubtitleCandidate } from "@shepherdjerred/streambot/sources/subtitles.ts";
import type { UserId } from "@shepherdjerred/streambot/types/ids.ts";

const SOURCES_TIMEOUT_MS = 15_000;
const SUBTITLE_ENUMERATION_TIMEOUT_MS = 15_000;

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
  replyPaginated: (payload: PaginatedPages) => Promise<void>;
  /**
   * Edit the deferred reply to show a subtitle-track picker built from `candidates`, and resolve
   * with the user's pick (an opaque encoded track ref) once they choose, or `null` on timeout.
   */
  replySelectMenu: (
    candidates: readonly SubtitleCandidate[],
  ) => Promise<string | null>;
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
  /**
   * Synchronously resolve a url/search `/stream play` source (yt-dlp) before acking, so bad input
   * gets a specific error instead of a silent "Queued". The result is threaded onto the queued item
   * so the machine's `resolving` state reuses it instead of re-fetching.
   */
  readonly resolvePlaySource: (
    source: Source,
    signal: AbortSignal,
  ) => Promise<ResolvedSource>;
  /** Post a world-readable message to the status channel (shaming, etc.). */
  readonly announce: (message: string) => Promise<void>;
  /** Enumerate burnable subtitle candidates for the currently-playing item; `/stream subtitles`'s picker. */
  readonly listSubtitleCandidates: (
    signal: AbortSignal,
  ) => Promise<SubtitleCandidate[]>;
  /** True while a subtitle picker is already open for this session (single-flight guard). */
  readonly hasPendingSubtitleMenu: () => boolean;
  /** Claim the single-flight slot; returns false if one was already claimed. */
  readonly claimSubtitleMenu: () => boolean;
  /** Release the single-flight slot (call on pick, timeout, or error). */
  readonly releaseSubtitleMenu: () => void;
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
    const sub = interaction.subcommand();
    if (await this.runPlaybackCommand(sub, interaction)) {
      return;
    }
    if (await this.runDiscoveryCommand(sub, interaction)) {
      return;
    }
    await interaction.reply("Unknown command.");
  }

  /** Playback/queue-control subcommands. Returns false (no reply sent) for an unrecognized sub. */
  private async runPlaybackCommand(
    sub: string,
    interaction: CommandInteraction,
  ): Promise<boolean> {
    switch (sub) {
      case "play":
        await runPlayCommand(this.deps, interaction, false);
        return true;
      case "playnext":
        await runPlayCommand(this.deps, interaction, true);
        return true;
      case "skip":
        await this.handleSkip(interaction);
        return true;
      case "stop":
        await this.handleStop(interaction);
        return true;
      case "queue":
        await interaction.reply(queueText(this.deps.view()));
        return true;
      case "nowplaying":
        await interaction.reply(nowPlayingText(this.deps.view()));
        return true;
      case "remove":
        await this.handleRemove(interaction);
        return true;
      case "clear":
        await this.handleClear(interaction);
        return true;
      case "move":
        await this.handleMove(interaction);
        return true;
      case "shuffle":
        await this.handleShuffle(interaction);
        return true;
      case "loop":
        await this.handleLoop(interaction);
        return true;
      case "volume":
        await this.handleVolume(interaction);
        return true;
      case "seek":
        await this.handleSeek(interaction);
        return true;
      case "chapters":
        await interaction.reply(chaptersText(this.deps.view()));
        return true;
      case "chapter":
        await this.handleChapter(interaction);
        return true;
      case "subtitles":
        await this.handleSubtitles(interaction);
        return true;
      default:
        return false;
    }
  }

  /** Library/discovery subcommands (no active session required). */
  private async runDiscoveryCommand(
    sub: string,
    interaction: CommandInteraction,
  ): Promise<boolean> {
    switch (sub) {
      case "list":
        await this.handleList(interaction, interaction.getString("filter"));
        return true;
      case "search":
        await this.handleList(
          interaction,
          interaction.getStringRequired("query"),
        );
        return true;
      case "sources":
        await this.handleSources(interaction);
        return true;
      case "help":
        await interaction.reply(helpText());
        return true;
      default:
        return false;
    }
  }

  private async handleList(
    interaction: CommandInteraction,
    query: string | null,
  ): Promise<void> {
    await interaction.defer();
    await interaction.replyPaginated(listPages(this.deps.library(), query));
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

  /**
   * `/stream subtitles` — presents a track picker built from the currently-playing item's actual
   * subtitle candidates (sidecar/embedded/yt-dlp), then dispatches `CHANGE_SUBTITLES` with the
   * exact pick. A single-flight guard rejects a second concurrent picker for the same session,
   * since two open menus dispatching independently would cause a confusing double-restart.
   */
  private async handleSubtitles(
    interaction: CommandInteraction,
  ): Promise<void> {
    const view = this.deps.view();
    const current = view.current;
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
      await interaction.reply(
        "Only the requester or an admin can change subtitles for this.",
      );
      return;
    }
    if (!this.deps.claimSubtitleMenu()) {
      await interaction.reply(
        "A subtitle picker is already open for this session — finish or let it time out first.",
      );
      return;
    }

    await interaction.defer();
    try {
      const candidates = await this.deps.listSubtitleCandidates(
        AbortSignal.timeout(SUBTITLE_ENUMERATION_TIMEOUT_MS),
      );
      if (candidates.length === 0) {
        await interaction.editReply(
          "No subtitle tracks were found for the current video.",
        );
        return;
      }
      const picked = await interaction.replySelectMenu(candidates);
      if (picked === null) {
        await interaction.editReply("Selection timed out.");
        return;
      }
      const subtitles: SubtitlePref = { trackRef: decodeTrackRef(picked) };
      this.deps.dispatch({
        type: "CHANGE_SUBTITLES",
        subtitles,
        positionSeconds: view.positionSeconds ?? 0,
      });
      await interaction.editReply(
        "🔄 Restarting with the selected subtitle track…",
      );
    } finally {
      this.deps.releaseSubtitleMenu();
    }
  }
}
