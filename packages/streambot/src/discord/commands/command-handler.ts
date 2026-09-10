import type {
  CommandHandlerDeps,
  CommandInteraction,
} from "@shepherdjerred/streambot/discord/commands/command-types.ts";
import { LoopModeSchema } from "@shepherdjerred/streambot/machine/types.ts";
import { canControlItem } from "@shepherdjerred/streambot/discord/permissions.ts";
import {
  formatTimecode,
  parseTimecode,
} from "@shepherdjerred/streambot/util/timecode.ts";
import {
  helpText,
  listPages,
  sourcesPages,
} from "@shepherdjerred/streambot/discord/commands/help-text.ts";
import type { SubtitlePref } from "@shepherdjerred/streambot/sources/source.ts";
import {
  chaptersText,
  nowPlayingText,
  queueText,
} from "@shepherdjerred/streambot/discord/queue-text.ts";
import { runPlayCommand } from "@shepherdjerred/streambot/discord/commands/play-command.ts";
import { decodeTrackRef } from "@shepherdjerred/streambot/discord/subtitle-menu.ts";
import { runVoiceDebugCommand } from "@shepherdjerred/streambot/discord/commands/voice-debug-command.ts";
import { PlaybackCommandService } from "@shepherdjerred/streambot/commands/playback-command-service.ts";
import type { PlaybackCommandResult } from "@shepherdjerred/streambot/commands/playback-command-types.ts";
import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import { MediaCommandHandler } from "@shepherdjerred/streambot/discord/commands/media-command-handler.ts";
import {
  inferMediaIntent,
  MediaSourcePreferenceSchema,
} from "@shepherdjerred/streambot/discovery/media-intent.ts";
import type { DiscoveryScope } from "@shepherdjerred/streambot/discovery/candidate.ts";

const SOURCES_TIMEOUT_MS = 15_000;

type PlaybackCommandDenial = { outcome: "denied"; message: string };
const SUBTITLE_ENUMERATION_TIMEOUT_MS = 15_000;

/**
 * Pure-ish command logic: routes a `/stream <subcommand>` interaction to the right machine event,
 * enforces permissions, and renders ephemeral acks. No discord.js dependency — fully unit-testable.
 */
export class CommandHandler {
  private readonly deps: CommandHandlerDeps;
  private readonly playback: PlaybackCommandService;
  private readonly media: MediaCommandHandler;

  constructor(deps: CommandHandlerDeps) {
    this.deps = deps;
    this.playback = new PlaybackCommandService(deps);
    this.media = new MediaCommandHandler(deps);
  }

  async run(interaction: CommandInteraction): Promise<void> {
    const sub = interaction.subcommand();
    const group = interaction.subcommandGroup();
    if (group === "voice-debug") {
      await runVoiceDebugCommand(this.deps, sub, interaction);
      return;
    }
    if (group === "playback") {
      await this.media.runPlayback(sub, interaction);
      return;
    }
    if (group === "history") {
      await this.media.runHistory(sub, interaction);
      return;
    }
    if (group === "personal") {
      await this.media.runPersonal(sub, interaction);
      return;
    }
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
      case "join":
        await interaction.reply(this.playback.join().message);
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
        await this.handleSearch(interaction);
        return true;
      case "sources":
        await this.handleSources(interaction);
        return true;
      case "help":
        await interaction.reply(helpText(this.deps.config.voice.enabled));
        return true;
      default:
        return false;
    }
  }

  private async handleSearch(interaction: CommandInteraction): Promise<void> {
    const query = interaction.getStringRequired("query");
    const scope = this.scope(interaction);
    if (
      scope === null ||
      this.deps.discovery === undefined ||
      !(await this.assistantEnabled(interaction))
    ) {
      await this.handleList(interaction, query);
      return;
    }
    const source = MediaSourcePreferenceSchema.parse(
      interaction.getString("source") ?? "auto",
    );
    await interaction.defer();
    const candidates = await this.deps.discovery.search(
      inferMediaIntent({ query, source }),
      scope,
      AbortSignal.timeout(SOURCES_TIMEOUT_MS),
    );
    await interaction.editReply(
      candidates.length === 0
        ? `No results for **${query}**.`
        : candidates
            .map(
              (candidate, index) =>
                `${String(index + 1)}. **${candidate.title}** — ${candidate.reason}`,
            )
            .join("\n"),
    );
  }

  private scope(interaction: CommandInteraction): DiscoveryScope | null {
    return this.deps.guildId === undefined || this.deps.channelId === undefined
      ? null
      : {
          guildId: this.deps.guildId,
          channelId: this.deps.channelId,
          userId: interaction.userId,
        };
  }

  private async assistantEnabled(
    interaction: CommandInteraction,
  ): Promise<boolean> {
    const scope = this.scope(interaction);
    return scope !== null && this.deps.featureGate !== undefined
      ? await this.deps.featureGate.assistantV2(scope)
      : true;
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
    const result = this.runBoundary(() =>
      this.playback.skip(interaction.userId),
    );
    await interaction.reply(
      result.outcome === "skipped" ? "⏭️ Skipped." : result.message,
    );
  }

  private async handleStop(interaction: CommandInteraction): Promise<void> {
    const result = this.runBoundary(() =>
      this.playback.stop(interaction.userId),
    );
    await interaction.reply(
      result.outcome === "stopped"
        ? "⏹️ Stopped and cleared the queue."
        : result.message,
    );
  }

  private async handleRemove(interaction: CommandInteraction): Promise<void> {
    const index = interaction.getIntegerRequired("index");
    const result = this.runBoundary(() =>
      this.playback.remove(interaction.userId, index),
    );
    await interaction.reply(result.message);
  }

  private async handleClear(interaction: CommandInteraction): Promise<void> {
    const result = this.runBoundary(() =>
      this.playback.clear(interaction.userId),
    );
    await interaction.reply(result.message);
  }

  private async handleMove(interaction: CommandInteraction): Promise<void> {
    const from = interaction.getIntegerRequired("from");
    const to = interaction.getIntegerRequired("to");
    this.deps.dispatch({ type: "MOVE", from, to });
    await interaction.reply(`Moved item ${String(from)} → ${String(to)}.`);
  }

  private async handleShuffle(interaction: CommandInteraction): Promise<void> {
    await interaction.reply(this.playback.shuffle().message);
  }

  private async handleLoop(interaction: CommandInteraction): Promise<void> {
    const parsed = LoopModeSchema.safeParse(
      interaction.getStringRequired("mode"),
    );
    if (!parsed.success) {
      await interaction.reply("Invalid loop mode.");
      return;
    }
    this.playback.setLoop(parsed.data);
    await interaction.reply(`🔁 Loop: **${parsed.data}**.`);
  }

  private async handleVolume(interaction: CommandInteraction): Promise<void> {
    const level = interaction.getIntegerRequired("level");
    const result = await this.playback.setVolume(level);
    await interaction.reply(
      result.outcome === "volume-deferred"
        ? `Volume set to ${String(level)}% for the next video.`
        : `🔊 Volume → ${String(level)}%.`,
    );
  }

  private async handleSeek(interaction: CommandInteraction): Promise<void> {
    const seconds = parseTimecode(interaction.getStringRequired("position"));
    if (seconds === null) {
      await interaction.reply("Invalid timestamp. Try 90, 1:30, or 1:02:03.");
      return;
    }
    const result = await this.runBoundaryAsync(() =>
      this.playback.seek(interaction.userId, seconds, false),
    );
    await interaction.reply(
      result.outcome === "seeked" ? `⏩ ${result.message}` : result.message,
    );
  }

  private runBoundary(
    operation: () => PlaybackCommandResult,
  ): PlaybackCommandResult | PlaybackCommandDenial {
    try {
      return operation();
    } catch (error) {
      if (error instanceof PlaybackCommandBoundaryError) {
        return { outcome: "denied", message: error.message };
      }
      throw error;
    }
  }

  private async runBoundaryAsync(
    operation: () => Promise<PlaybackCommandResult>,
  ): Promise<PlaybackCommandResult | PlaybackCommandDenial> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof PlaybackCommandBoundaryError) {
        return { outcome: "denied", message: error.message };
      }
      throw error;
    }
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
    // An audio-only item has no picture to burn a track into, and `prepareStream` hard-throws when
    // `subtitleBurn` meets `audioOnly`. Refuse here with the fix rather than letting the request
    // reach the streamer and fail the segment.
    if (current.mediaKind === "music") {
      await interaction.reply(
        "This is playing as audio only, so there's no picture to burn subtitles into. Requeue it with `mode:video` for a video stream.",
      );
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
      // Identity of the item whose candidates the picker will show. The candidates are enumerated
      // from THIS source; a pick is only valid if this exact item is still current at dispatch time.
      const pickedFromSourceId = this.deps.currentSourceId();
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
      const trackRef = decodeTrackRef(picked);

      // Playback can move on (natural end, skip, another change) during the picker's wait — re-check
      // the current item's stable identity right before dispatching. Comparing the source identity
      // (not the display title) catches a same-title-but-different-item swap that would otherwise
      // burn the old item's subtitle track onto the new one or throw in the exact subtitle resolver.
      // The `kind:` prefix on the identity also covers a source-kind change.
      if (this.deps.currentSourceId() !== pickedFromSourceId) {
        await interaction.editReply(
          "Playback changed while you were choosing — nothing was applied. Try again.",
        );
        return;
      }
      const nowView = this.deps.view();

      const subtitles: SubtitlePref = { trackRef };
      this.deps.dispatch({
        type: "CHANGE_SUBTITLES",
        subtitles,
        positionSeconds: nowView.positionSeconds ?? 0,
      });
      await interaction.editReply(
        "🔄 Restarting with the selected subtitle track…",
      );
    } finally {
      this.deps.releaseSubtitleMenu();
    }
  }
}
