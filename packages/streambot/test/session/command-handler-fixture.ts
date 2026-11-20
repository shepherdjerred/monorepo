import { AUDIO_CHANNEL } from "@shepherdjerred/streambot/types/playback-channel.ts";
import type { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";
import { CommandHandler } from "@shepherdjerred/streambot/discord/commands/command-handler.ts";
import type {
  CommandHandlerDeps,
  CommandInteraction,
} from "@shepherdjerred/streambot/discord/commands/command-types.ts";
import type { PlaybackView } from "@shepherdjerred/streambot/machine/view.ts";
import type { PaginatedPages } from "@shepherdjerred/streambot/discord/commands/help-text.ts";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import type {
  PlaybackEvent,
  ResolvedSource,
} from "@shepherdjerred/streambot/machine/types.ts";
import {
  UserIdSchema,
  type UserId,
} from "@shepherdjerred/streambot/types/ids.ts";
import type { LibraryEntry } from "@shepherdjerred/streambot/sources/library.ts";
import type { SubtitleCandidate } from "@shepherdjerred/streambot/sources/subtitles.ts";

export const ADMIN = "160509172704739328";
export const REQUESTER = "100000000000000001";
export const OTHER = "200000000000000002";
export const GUILD = "208425771172102144";
export const CHANNEL = "692223827475824650";

export function uid(value: string): UserId {
  return UserIdSchema.parse(value);
}

export function makeConfig(adminIds: string[], voiceEnabled = false) {
  return loadConfig({
    BOT_TOKEN: "bot-token",
    TOKEN: "user-token",
    GUILD_ID: GUILD,
    COMMAND_CHANNEL_ID: CHANNEL,
    VIDEO_CHANNEL_ID: CHANNEL,
    ADMIN_IDS: adminIds.join(","),
    VIDEOS_DIR: "/tmp/videos",
    ...(voiceEnabled
      ? {
          VOICE_ASSISTANT_ENABLED: "true",
          OPENAI_API_KEY: "test-openai-key",
        }
      : {}),
  });
}

export const RESOLVED_STUB: ResolvedSource = {
  title: "resolved",
  ffmpegInput: "resolved://input",
  mediaKind: "video",
  chapters: [],
};

export const EMPTY_VIEW: PlaybackView = {
  state: "idle",
  current: null,
  queue: [],
  loop: "off",
  volume: 100,
  positionSeconds: null,
};

export type Harness = {
  handler: CommandHandler;
  events: PlaybackEvent[];
  announces: string[];
  debugStarts: number[];
};

export function firstMessage(messages: readonly string[]): string {
  const message = messages[0];
  if (message === undefined) {
    throw new Error("Expected the command handler to emit a message");
  }
  return message;
}

export function makeHandler(over: {
  adminIds?: string[];
  view?: PlaybackView;
  library?: LibraryEntry[];
  volumeApplied?: boolean;
  seekApplied?: boolean;
  playlistItems?: { url: string; title: string }[];
  sources?: string[];
  resolvedSource?: ResolvedSource;
  resolvePlayError?: Error;
  /** Let this many resolves succeed before `resolvePlayError` starts failing them. */
  resolvePlayErrorAfter?: number;
  /** Route playback automatically (numbered channels), as the slash command does in production. */
  routed?: boolean;
  subtitleCandidates?: SubtitleCandidate[];
  subtitleMenuAlreadyPending?: boolean;
  voiceEnabled?: boolean;
  /**
   * Stable identity of the currently-playing source, as `currentSourceId()` reports it. Defaults to
   * `"file:/current"` when `view.current` is set, else `null`. Pass an array to make consecutive
   * reads differ (the handler reads once when the picker opens and again before dispatch) — the
   * second value simulates playback advancing to a different item during the picker's wait.
   */
  currentSourceId?: string | null | (string | null)[];
  /** Rollout gate plus a real in-memory history, for the `/stream personal usual` replay path. */
  musicOverVoice?: boolean;
  history?: MediaHistoryStore;
}): Harness & { seeks: number[]; subtitleMenuPending: () => boolean } {
  const events: PlaybackEvent[] = [];
  const announces: string[] = [];
  const seeks: number[] = [];
  const debugStarts: number[] = [];
  let subtitleMenuPending = over.subtitleMenuAlreadyPending ?? false;
  const defaultSourceId =
    (over.view?.current ?? null) === null ? null : "file:/current";
  const sourceIdReads =
    over.currentSourceId === undefined
      ? [defaultSourceId]
      : Array.isArray(over.currentSourceId)
        ? over.currentSourceId
        : [over.currentSourceId];
  let sourceIdReadIndex = 0;
  let resolveCalls = 0;
  const deps: CommandHandlerDeps = {
    config: makeConfig(over.adminIds ?? [], over.voiceEnabled),
    dispatch: (event) => events.push(event),
    view: () => over.view ?? EMPTY_VIEW,
    library: () => over.library ?? [],
    setVolume: () => Promise.resolve(over.volumeApplied ?? true),
    seek: (seconds) => {
      seeks.push(seconds);
      return Promise.resolve(over.seekApplied ?? true);
    },
    expandPlaylist: () => Promise.resolve(over.playlistItems ?? []),
    listSources: () => Promise.resolve(over.sources ?? []),
    resolvePlaySource: () =>
      over.resolvePlayError === undefined ||
      resolveCalls++ < (over.resolvePlayErrorAfter ?? 0)
        ? Promise.resolve(over.resolvedSource ?? RESOLVED_STUB)
        : Promise.reject(over.resolvePlayError),
    announce: (message) => {
      announces.push(message);
      return Promise.resolve();
    },
    listSubtitleCandidates: () =>
      Promise.resolve(over.subtitleCandidates ?? []),
    currentSourceId: () => {
      const read =
        sourceIdReads[Math.min(sourceIdReadIndex, sourceIdReads.length - 1)] ??
        null;
      sourceIdReadIndex += 1;
      return read;
    },
    hasPendingSubtitleMenu: () => subtitleMenuPending,
    claimSubtitleMenu: () => {
      if (subtitleMenuPending) return false;
      subtitleMenuPending = true;
      return true;
    },
    releaseSubtitleMenu: () => {
      subtitleMenuPending = false;
    },
    startVoiceDebugCapture: (durationSeconds) => {
      debugStarts.push(durationSeconds);
      return {
        outcome: "started",
        status: {
          captureId: "00000000-0000-4000-8000-000000000001",
          guildId: GUILD,
          channelId: CHANNEL,
          sessionId: "11111111-1111-4111-8111-111111111111",
          startedAtMs: Date.now(),
          expiresAtMs: Date.now() + durationSeconds * 1000,
          speakerCount: 0,
          bufferedBytes: 0,
          truncated: false,
        },
      };
    },
    stopVoiceDebugCapture: () => ({ outcome: "none" }),
    voiceDebugCaptureStatus: () => null,
    guildId: GUILD,
    channelId: CHANNEL,
    ...(over.routed === true
      ? {
          routePlayback: () =>
            Promise.resolve({ ...deps, playbackChannel: AUDIO_CHANNEL }),
        }
      : {}),
    ...(over.musicOverVoice === undefined
      ? {}
      : {
          featureGate: {
            assistantV2: () => Promise.resolve(true),
            history: () => Promise.resolve(true),
            musicOverVoice: () => Promise.resolve(over.musicOverVoice ?? false),
          },
        }),
    ...(over.history === undefined ? {} : { history: over.history }),
  };
  return {
    handler: new CommandHandler(deps),
    events,
    announces,
    debugStarts,
    seeks,
    subtitleMenuPending: () => subtitleMenuPending,
  };
}

export type FakeOpts = {
  userId?: string;
  sub: string;
  group?: string;
  strings?: Record<string, string>;
  integers?: Record<string, number>;
  /** What `replySelectMenu` resolves with — the user's (fake) pick, or null to simulate a timeout. */
  subtitleMenuPick?: string | null;
};

export function fakeInteraction(opts: FakeOpts): {
  interaction: CommandInteraction;
  replies: string[];
  edits: string[];
  paginated: PaginatedPages[];
  selectMenuCandidates: (readonly SubtitleCandidate[])[];
  state: { deferred: boolean };
} {
  const replies: string[] = [];
  const edits: string[] = [];
  const paginated: PaginatedPages[] = [];
  const selectMenuCandidates: (readonly SubtitleCandidate[])[] = [];
  const state = { deferred: false };
  const interaction: CommandInteraction = {
    userId: uid(opts.userId ?? REQUESTER),
    subcommand: () => opts.sub,
    subcommandGroup: () => opts.group ?? null,
    getString: (name) => opts.strings?.[name] ?? null,
    getInteger: (name) => opts.integers?.[name] ?? null,
    getStringRequired: (name) => {
      const value = opts.strings?.[name];
      if (value === undefined) {
        throw new Error(`missing required string: ${name}`);
      }
      return value;
    },
    getIntegerRequired: (name) => {
      const value = opts.integers?.[name];
      if (value === undefined) {
        throw new Error(`missing required integer: ${name}`);
      }
      return value;
    },
    reply: (content) => {
      replies.push(content);
      return Promise.resolve();
    },
    defer: () => {
      state.deferred = true;
      return Promise.resolve();
    },
    editReply: (content) => {
      edits.push(content);
      return Promise.resolve();
    },
    replyPaginated: (payload) => {
      paginated.push(payload);
      return Promise.resolve();
    },
    replySelectMenu: (candidates) => {
      selectMenuCandidates.push(candidates);
      return Promise.resolve(opts.subtitleMenuPick ?? null);
    },
  };
  return {
    interaction,
    replies,
    edits,
    paginated,
    selectMenuCandidates,
    state,
  };
}
