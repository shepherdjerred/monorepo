import { z } from "zod";

const EmptyInputSchema = z.strictObject({});

export const voiceToolSchemas = {
  play: z.strictObject({
    query: z.string().min(1),
    source: z.enum(["auto", "history", "local", "youtube"]),
    placement: z.enum(["queue", "next", "now"]),
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
  subtitles: z.strictObject({
    mode: z.enum(["off", "auto", "language"]),
    language: z.string().min(1).nullable(),
  }),
  pause: EmptyInputSchema,
  resume: EmptyInputSchema,
  restart: EmptyInputSchema,
  previous: EmptyInputSchema,
  searchLibrary: z.strictObject({ query: z.string().min(1) }),
  searchMedia: z.strictObject({
    query: z.string().min(1),
    source: z.enum(["auto", "history", "local", "youtube"]),
  }),
  listChapters: EmptyInputSchema,
  getQueue: EmptyInputSchema,
  getNowPlaying: EmptyInputSchema,
} as const;

export type ToolName =
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
  | "subtitles"
  | "pause"
  | "resume"
  | "restart"
  | "previous"
  | "search_library"
  | "search_media"
  | "list_chapters"
  | "get_queue"
  | "get_now_playing";

export type PlayArguments = z.infer<typeof voiceToolSchemas.play>;
export type SeekArguments = z.infer<typeof voiceToolSchemas.seek>;
export type LoopArguments = z.infer<typeof voiceToolSchemas.setLoop>;

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
      readonly name: "subtitles";
      readonly arguments: z.infer<typeof voiceToolSchemas.subtitles>;
    }
  | { readonly name: "pause"; readonly arguments: Record<string, never> }
  | { readonly name: "resume"; readonly arguments: Record<string, never> }
  | { readonly name: "restart"; readonly arguments: Record<string, never> }
  | { readonly name: "previous"; readonly arguments: Record<string, never> }
  | {
      readonly name: "search_library";
      readonly arguments: z.infer<typeof voiceToolSchemas.searchLibrary>;
    }
  | {
      readonly name: "search_media";
      readonly arguments: z.infer<typeof voiceToolSchemas.searchMedia>;
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
