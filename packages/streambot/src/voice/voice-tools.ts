import { tool } from "@openai/agents/realtime";
import { z } from "zod";
import {
  PlaybackCommandBoundaryError,
  type PlaybackCommandService,
} from "@shepherdjerred/streambot/commands/playback-command-service.ts";
import { voiceToolCallsTotal } from "@shepherdjerred/streambot/observability/metrics.ts";
import type { UserId } from "@shepherdjerred/streambot/types/ids.ts";

const EmptyInputSchema = z.strictObject({});
export const voiceToolSchemas = {
  play: z.strictObject({
    query: z.string().min(1),
    source: z.enum(["auto", "local", "youtube"]),
    placement: z.enum(["queue", "next"]),
  }),
  skip: EmptyInputSchema,
  stop: EmptyInputSchema,
  seek: z.strictObject({
    seconds: z.number(),
    mode: z.enum(["absolute", "relative"]),
  }),
  setVolume: z.strictObject({ percent: z.number().int().min(0).max(200) }),
  setLoop: z.strictObject({ mode: z.enum(["off", "track", "queue"]) }),
  shuffle: EmptyInputSchema,
  remove: z.strictObject({ position: z.number().int().min(1) }),
  clear: EmptyInputSchema,
  move: z.strictObject({
    from: z.number().int().min(1),
    to: z.number().int().min(1),
  }),
  chapter: z.strictObject({
    target: z.union([z.number().int().min(1), z.enum(["next", "previous"])]),
  }),
  subtitlesOff: EmptyInputSchema,
  searchLibrary: z.strictObject({ query: z.string().min(1) }),
  listChapters: EmptyInputSchema,
  getQueue: EmptyInputSchema,
  getNowPlaying: EmptyInputSchema,
} as const;

type ToolName =
  | "play"
  | "skip"
  | "stop"
  | "seek"
  | "set_volume"
  | "set_loop"
  | "shuffle"
  | "remove"
  | "clear"
  | "move"
  | "chapter"
  | "subtitles_off"
  | "search_library"
  | "list_chapters"
  | "get_queue"
  | "get_now_playing";

type PlayArguments = z.infer<typeof voiceToolSchemas.play>;
type SeekArguments = z.infer<typeof voiceToolSchemas.seek>;
type LoopArguments = z.infer<typeof voiceToolSchemas.setLoop>;

export type VoiceCommandInvocation =
  | { readonly name: "play"; readonly arguments: PlayArguments }
  | { readonly name: "skip"; readonly arguments: Record<string, never> }
  | { readonly name: "stop"; readonly arguments: Record<string, never> }
  | { readonly name: "seek"; readonly arguments: SeekArguments }
  | {
      readonly name: "set_volume";
      readonly arguments: z.infer<typeof voiceToolSchemas.setVolume>;
    }
  | { readonly name: "set_loop"; readonly arguments: LoopArguments }
  | { readonly name: "shuffle"; readonly arguments: Record<string, never> }
  | {
      readonly name: "remove";
      readonly arguments: z.infer<typeof voiceToolSchemas.remove>;
    }
  | { readonly name: "clear"; readonly arguments: Record<string, never> }
  | {
      readonly name: "move";
      readonly arguments: z.infer<typeof voiceToolSchemas.move>;
    }
  | {
      readonly name: "chapter";
      readonly arguments: z.infer<typeof voiceToolSchemas.chapter>;
    }
  | {
      readonly name: "subtitles_off";
      readonly arguments: Record<string, never>;
    }
  | {
      readonly name: "search_library";
      readonly arguments: z.infer<typeof voiceToolSchemas.searchLibrary>;
    }
  | {
      readonly name: "list_chapters";
      readonly arguments: Record<string, never>;
    }
  | { readonly name: "get_queue"; readonly arguments: Record<string, never> }
  | {
      readonly name: "get_now_playing";
      readonly arguments: Record<string, never>;
    };

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
  readonly searchLibrary: (query: string) => string | Promise<string>;
  readonly listChapters: () => string | Promise<string>;
  readonly getQueue: () => string | Promise<string>;
  readonly getNowPlaying: () => string | Promise<string>;
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
    // Five grounded titles is plenty for one spoken disambiguation and keeps the tool result
    // small in the realtime context.
    searchLibrary: (query) => service.searchLibraryTitles(query, 5),
    listChapters: () => service.listChapters(),
    getQueue: () => service.getQueue(),
    getNowPlaying: () => service.getNowPlaying(),
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
) {
  async function invoke(
    name: ToolName,
    mutating: boolean,
    operation: () => string | Promise<string>,
  ): Promise<string> {
    if (transactionSignal.aborted) {
      voiceToolCallsTotal.inc({ tool: name, outcome: "expired" });
      return "That voice command expired. Say Hey Streambot and try again.";
    }
    if (mutating && !mutationGate.claim()) {
      voiceToolCallsTotal.inc({
        tool: name,
        outcome: "rejected-second-mutation",
      });
      return "Only one playback change is allowed per wake phrase. Ask again for another change.";
    }
    try {
      const result = await operation();
      voiceToolCallsTotal.inc({ tool: name, outcome: "success" });
      return result;
    } catch (error) {
      if (error instanceof PlaybackCommandBoundaryError) {
        if (mutating) mutationGate.release();
        voiceToolCallsTotal.inc({ tool: name, outcome: "denied" });
        return error.message;
      }
      voiceToolCallsTotal.inc({ tool: name, outcome: "error" });
      throw error;
    }
  }

  return [
    tool({
      name: "play",
      description:
        "Play or queue a media title from the local library or YouTube search.",
      parameters: voiceToolSchemas.play,
      execute: (input) =>
        invoke("play", true, () => commands.play(input, transactionSignal)),
    }),
    tool({
      name: "skip",
      description: "Skip the currently playing item.",
      parameters: voiceToolSchemas.skip,
      execute: () => invoke("skip", true, () => commands.skip()),
    }),
    tool({
      name: "stop",
      description: "Stop playback and clear the queue. Admin only.",
      parameters: voiceToolSchemas.stop,
      execute: () => invoke("stop", true, () => commands.stop()),
    }),
    tool({
      name: "seek",
      description:
        "Seek to an absolute number of seconds or move relative to the current position.",
      parameters: voiceToolSchemas.seek,
      execute: (input) => invoke("seek", true, () => commands.seek(input)),
    }),
    tool({
      name: "set_volume",
      description: "Set playback volume from 0 through 200 percent.",
      parameters: voiceToolSchemas.setVolume,
      execute: (input) =>
        invoke("set_volume", true, () => commands.setVolume(input.percent)),
    }),
    tool({
      name: "set_loop",
      description:
        "Set loop mode to off, the current track, or the full queue.",
      parameters: voiceToolSchemas.setLoop,
      execute: (input) =>
        invoke("set_loop", true, () => commands.setLoop(input.mode)),
    }),
    tool({
      name: "shuffle",
      description: "Shuffle the queued items.",
      parameters: voiceToolSchemas.shuffle,
      execute: () => invoke("shuffle", true, () => commands.shuffle()),
    }),
    tool({
      name: "remove",
      description: "Remove a queued item by its 1-based queue position.",
      parameters: voiceToolSchemas.remove,
      execute: (input) =>
        invoke("remove", true, () => commands.remove(input.position)),
    }),
    tool({
      name: "clear",
      description: "Clear the whole queue. Admin only.",
      parameters: voiceToolSchemas.clear,
      execute: () => invoke("clear", true, () => commands.clear()),
    }),
    tool({
      name: "move",
      description: "Move a queued item from one 1-based position to another.",
      parameters: voiceToolSchemas.move,
      execute: (input) =>
        invoke("move", true, () => commands.move(input.from, input.to)),
    }),
    tool({
      name: "chapter",
      description:
        "Jump to a chapter of the current video by number, or to the next/previous chapter.",
      parameters: voiceToolSchemas.chapter,
      execute: (input) =>
        invoke("chapter", true, () => commands.jumpToChapter(input.target)),
    }),
    tool({
      name: "subtitles_off",
      description:
        "Turn subtitles off for the current video. Enabling a specific track needs the /stream subtitles picker.",
      parameters: voiceToolSchemas.subtitlesOff,
      execute: () =>
        invoke("subtitles_off", true, () => commands.subtitlesOff()),
    }),
    tool({
      name: "search_library",
      description:
        "Search the local library by title and hear the closest matches, without changing playback. Use this to disambiguate before play.",
      parameters: voiceToolSchemas.searchLibrary,
      execute: (input) =>
        invoke("search_library", false, () =>
          commands.searchLibrary(input.query),
        ),
    }),
    tool({
      name: "list_chapters",
      description: "Read the current video's chapter list without seeking.",
      parameters: voiceToolSchemas.listChapters,
      execute: () =>
        invoke("list_chapters", false, () => commands.listChapters()),
    }),
    tool({
      name: "get_queue",
      description: "Read the current playback queue without changing it.",
      parameters: voiceToolSchemas.getQueue,
      execute: () => invoke("get_queue", false, () => commands.getQueue()),
    }),
    tool({
      name: "get_now_playing",
      description: "Read the currently playing item without changing it.",
      parameters: voiceToolSchemas.getNowPlaying,
      execute: () =>
        invoke("get_now_playing", false, () => commands.getNowPlaying()),
    }),
  ];
}
