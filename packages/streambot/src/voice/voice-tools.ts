import { tool } from "@openai/agents/realtime";
import { type PlaybackCommandService } from "@shepherdjerred/streambot/commands/playback-command-service.ts";
import {
  PlaybackCommandBlockedError,
  PlaybackCommandBoundaryError,
} from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import { voiceToolCallsTotal } from "@shepherdjerred/streambot/observability/metrics.ts";
import { voiceToolDurationSeconds } from "@shepherdjerred/streambot/observability/voice-diagnostic-metrics.ts";
import type { UserId } from "@shepherdjerred/streambot/types/ids.ts";
import {
  NOOP_VOICE_ATTEMPT_OBSERVER,
  type VoiceAttemptHandle,
} from "@shepherdjerred/streambot/voice/attempt-context.ts";
import {
  voiceToolSchemas,
  type LoopArguments,
  type PlayArguments,
  type SeekArguments,
  type ToolName,
} from "@shepherdjerred/streambot/voice/voice-tool-types.ts";

const ADVANCED_TOOL_NAMES = new Set<ToolName>([
  "pause",
  "resume",
  "restart",
  "previous",
  "search_media",
]);

/** User/session-bound command surface shared by production execution and local dry runs. */
export type VoiceCommandPort = {
  readonly play: (
    input: PlayArguments,
    signal: AbortSignal,
  ) => string | Promise<string>;
  readonly skip: () => string | Promise<string>;
  readonly stop: () => string | Promise<string>;
  readonly seek: (input: SeekArguments) => string | Promise<string>;
  readonly setVolume: (percent: number) => string | Promise<string>;
  readonly setLoop: (mode: LoopArguments["mode"]) => string | Promise<string>;
  readonly shuffle: () => string | Promise<string>;
  readonly remove: (position: number) => string | Promise<string>;
  readonly clear: () => string | Promise<string>;
  readonly move: (from: number, to: number) => string | Promise<string>;
  readonly jumpToChapter: (
    target: number | "next" | "previous",
  ) => string | Promise<string>;
  readonly subtitlesOff: () => string | Promise<string>;
  readonly subtitles: (
    mode: "off" | "auto" | "language",
    language: string | null,
  ) => string | Promise<string>;
  readonly pause: () => string | Promise<string>;
  readonly resume: () => string | Promise<string>;
  readonly restart: () => string | Promise<string>;
  readonly previous: (signal: AbortSignal) => string | Promise<string>;
  readonly searchLibrary: (query: string) => string | Promise<string>;
  readonly searchMedia: (
    query: string,
    source: PlayArguments["source"],
    signal: AbortSignal,
  ) => string | Promise<string>;
  readonly listChapters: () => string | Promise<string>;
  readonly getQueue: () => string | Promise<string>;
  readonly getNowPlaying: () => string | Promise<string>;
  /** Optional rollout gate for newly added assistant-v2 controls. */
  readonly isAssistantV2Enabled?: () => Promise<boolean>;
  /** Monotonic version incremented when the current turn asks for a numbered selection. */
  readonly clarificationVersion?: () => number;
};

export function bindPlaybackVoiceCommandPort(
  service: PlaybackCommandService,
  userId: UserId,
): VoiceCommandPort {
  return {
    play: async (input, signal) => {
      const result = await service.play({ ...input, userId, signal });
      return result.message;
    },
    skip: () => service.skip(userId).message,
    stop: () => service.stop(userId).message,
    seek: async (input) => {
      const result = await service.seek(
        userId,
        input.seconds,
        input.mode === "relative",
      );
      return result.message;
    },
    setVolume: async (percent) => {
      const result = await service.setVolume(percent);
      return result.message;
    },
    setLoop: (mode) => service.setLoop(mode).message,
    shuffle: () => service.shuffle().message,
    remove: (position) => service.remove(userId, position).message,
    clear: () => service.clear(userId).message,
    move: (from, to) => service.move(from, to).message,
    jumpToChapter: async (target) => {
      const result = await service.jumpToChapter(userId, target);
      return result.message;
    },
    subtitlesOff: () => service.subtitlesOff(userId).message,
    subtitles: (mode, language) =>
      service.subtitles(userId, mode, language ?? undefined).message,
    pause: () => service.pause(userId).message,
    resume: () => service.resume(userId).message,
    restart: () => service.restart(userId).message,
    previous: async (signal) => {
      const result = await service.previous(userId, signal);
      return result.message;
    },
    // Five grounded titles is plenty for one spoken disambiguation and keeps the tool result
    // small in the realtime context.
    searchLibrary: (query) => service.searchLibraryTitles(query, 5),
    searchMedia: (query, source, signal) =>
      service.searchMediaTitles(query, userId, source, signal),
    listChapters: () => service.listChapters(),
    getQueue: () => service.getQueue(),
    getNowPlaying: () => service.getNowPlaying(),
    isAssistantV2Enabled: () => service.isAssistantV2Enabled(userId),
    clarificationVersion: () => service.clarificationVersion(),
  };
}

export class VoiceMutationGate {
  private mutated = false;

  claim(): boolean {
    if (this.mutated) return false;
    this.mutated = true;
    return true;
  }

  /**
   * Undo a claim whose operation failed at the input boundary, before any playback mutation —
   * every PlaybackCommandBoundaryError throws pre-dispatch, so the model may retry with corrected
   * arguments instead of burning the whole wake on one bad guess. Never released for unknown
   * errors: those may have landed after a dispatch, and a burned wake is safer than two mutations.
   */
  release(): void {
    this.mutated = false;
  }

  get hasMutated(): boolean {
    return this.mutated;
  }
}

export function createStreambotVoiceTools(
  commands: VoiceCommandPort,
  mutationGate: VoiceMutationGate,
  transactionSignal: AbortSignal = new AbortController().signal,
  attempt: VoiceAttemptHandle = NOOP_VOICE_ATTEMPT_OBSERVER.begin(),
) {
  async function invoke(
    name: ToolName,
    mutating: boolean,
    toolArguments: unknown,
    operation: () => string | Promise<string>,
  ): Promise<string> {
    const startedAt = performance.now();
    return await attempt.runStage(
      `streambot.voice.tool.${name}`,
      {
        "streambot.voice.tool.name": name,
        "streambot.voice.tool.arguments": JSON.stringify(toolArguments),
        "streambot.voice.tool.mutating": mutating,
      },
      async (span) => {
        let outcome = "error";
        let result: string | undefined;
        try {
          if (transactionSignal.aborted) {
            outcome = "expired";
            result =
              "That voice command expired. Say Hey Streambot and try again.";
            return result;
          }
          if (
            ADVANCED_TOOL_NAMES.has(name) &&
            commands.isAssistantV2Enabled !== undefined &&
            !(await commands.isAssistantV2Enabled())
          ) {
            outcome = "disabled";
            result = "That advanced playback control is not enabled here.";
            return result;
          }
          if (mutating && !mutationGate.claim()) {
            outcome = "rejected-second-mutation";
            result =
              "Only one playback change is allowed per wake phrase. Ask again for another change.";
            return result;
          }
          try {
            result = await operation();
            outcome = "success";
            return result;
          } catch (error) {
            if (error instanceof PlaybackCommandBoundaryError) {
              // A blocked-source denial already fired its public shame announce, so its wake stays
              // burned; only side-effect-free boundary failures earn a corrected retry.
              if (mutating && !(error instanceof PlaybackCommandBlockedError)) {
                mutationGate.release();
              }
              outcome = "denied";
              result = error.message;
              return result;
            }
            throw error;
          }
        } finally {
          const durationMs = performance.now() - startedAt;
          voiceToolCallsTotal.inc({ tool: name, outcome });
          voiceToolDurationSeconds.observe(
            { tool: name, outcome },
            durationMs / 1000,
          );
          span.setAttributes({
            "streambot.voice.tool.outcome": outcome,
            "streambot.voice.tool.result": result ?? "",
            "streambot.voice.tool.duration_ms": durationMs,
          });
          attempt.tool({
            name,
            arguments: toolArguments,
            ...(result === undefined ? {} : { result }),
            outcome,
            durationMs,
          });
        }
      },
    );
  }

  return [
    tool({
      name: "play",
      description:
        "Play or queue a media title from the local library or YouTube search.",
      parameters: voiceToolSchemas.play,
      execute: (input) =>
        invoke("play", true, input, () =>
          commands.play(input, transactionSignal),
        ),
    }),
    tool({
      name: "skip",
      description: "Skip the currently playing item.",
      parameters: voiceToolSchemas.skip,
      execute: (input) => invoke("skip", true, input, () => commands.skip()),
    }),
    tool({
      name: "stop",
      description: "Stop playback and clear the queue. Admin only.",
      parameters: voiceToolSchemas.stop,
      execute: (input) => invoke("stop", true, input, () => commands.stop()),
    }),
    tool({
      name: "seek",
      description:
        "Seek to an absolute number of seconds or move relative to the current position.",
      parameters: voiceToolSchemas.seek,
      execute: (input) =>
        invoke("seek", true, input, () => commands.seek(input)),
    }),
    tool({
      name: "set_volume",
      description: "Set playback volume from 0 through 200 percent.",
      parameters: voiceToolSchemas.setVolume,
      execute: (input) =>
        invoke("set_volume", true, input, () =>
          commands.setVolume(input.percent),
        ),
    }),
    tool({
      name: "set_loop",
      description:
        "Set loop mode to off, the current track, or the full queue.",
      parameters: voiceToolSchemas.setLoop,
      execute: (input) =>
        invoke("set_loop", true, input, () => commands.setLoop(input.mode)),
    }),
    tool({
      name: "shuffle",
      description: "Shuffle the queued items.",
      parameters: voiceToolSchemas.shuffle,
      execute: (input) =>
        invoke("shuffle", true, input, () => commands.shuffle()),
    }),
    tool({
      name: "remove",
      description: "Remove a queued item by its 1-based queue position.",
      parameters: voiceToolSchemas.remove,
      execute: (input) =>
        invoke("remove", true, input, () => commands.remove(input.position)),
    }),
    tool({
      name: "clear",
      description: "Clear the whole queue. Admin only.",
      parameters: voiceToolSchemas.clear,
      execute: (input) => invoke("clear", true, input, () => commands.clear()),
    }),
    tool({
      name: "move",
      description: "Move a queued item from one 1-based position to another.",
      parameters: voiceToolSchemas.move,
      execute: (input) =>
        invoke("move", true, input, () => commands.move(input.from, input.to)),
    }),
    tool({
      name: "chapter",
      description:
        "Jump to a chapter of the current video by number, or to the next/previous chapter.",
      parameters: voiceToolSchemas.chapter,
      execute: (input) =>
        invoke("chapter", true, input, () =>
          commands.jumpToChapter(input.target),
        ),
    }),
    tool({
      name: "subtitles_off",
      description:
        "Turn subtitles off for the current video. Enabling a specific track needs the /stream subtitles picker.",
      parameters: voiceToolSchemas.subtitlesOff,
      execute: (input) =>
        invoke("subtitles_off", true, input, () => commands.subtitlesOff()),
    }),
    tool({
      name: "subtitles",
      description:
        "Set subtitles off, automatic, or to a requested language for the current video.",
      parameters: voiceToolSchemas.subtitles,
      execute: (input) =>
        invoke("subtitles", true, input, () =>
          commands.subtitles(input.mode, input.language),
        ),
    }),
    tool({
      name: "pause",
      description: "Pause the current video.",
      parameters: voiceToolSchemas.pause,
      execute: (input) => invoke("pause", true, input, () => commands.pause()),
    }),
    tool({
      name: "resume",
      description: "Resume a paused video.",
      parameters: voiceToolSchemas.resume,
      execute: (input) =>
        invoke("resume", true, input, () => commands.resume()),
    }),
    tool({
      name: "restart",
      description: "Restart the current video from the beginning.",
      parameters: voiceToolSchemas.restart,
      execute: (input) =>
        invoke("restart", true, input, () => commands.restart()),
    }),
    tool({
      name: "previous",
      description: "Play the previous item from this server again.",
      parameters: voiceToolSchemas.previous,
      execute: (input) =>
        invoke("previous", true, input, () =>
          commands.previous(transactionSignal),
        ),
    }),
    tool({
      name: "search_library",
      description:
        "Search the local library by title and hear the closest matches, without changing playback. Use this to disambiguate before play.",
      parameters: voiceToolSchemas.searchLibrary,
      execute: (input) =>
        invoke("search_library", false, input, () =>
          commands.searchLibrary(input.query),
        ),
    }),
    tool({
      name: "search_media",
      description:
        "Search playback history, local files, and YouTube and return up to five numbered matches. Use this for ambiguous titles and character covers.",
      parameters: voiceToolSchemas.searchMedia,
      execute: (input) =>
        invoke("search_media", false, input, () =>
          commands.searchMedia(input.query, input.source, transactionSignal),
        ),
    }),
    tool({
      name: "list_chapters",
      description: "Read the current video's chapter list without seeking.",
      parameters: voiceToolSchemas.listChapters,
      execute: (input) =>
        invoke("list_chapters", false, input, () => commands.listChapters()),
    }),
    tool({
      name: "get_queue",
      description: "Read the current playback queue without changing it.",
      parameters: voiceToolSchemas.getQueue,
      execute: (input) =>
        invoke("get_queue", false, input, () => commands.getQueue()),
    }),
    tool({
      name: "get_now_playing",
      description: "Read the currently playing item without changing it.",
      parameters: voiceToolSchemas.getNowPlaying,
      execute: (input) =>
        invoke("get_now_playing", false, input, () => commands.getNowPlaying()),
    }),
  ];
}
