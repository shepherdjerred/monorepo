import { afterEach, vi, type Mock } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import { SessionManager } from "@shepherdjerred/streambot/session/session-manager.ts";
import type { StreamerLike } from "@shepherdjerred/streambot/streamer/streamer-types.ts";
import type {
  UserbotEntry,
  UserbotProvider,
} from "@shepherdjerred/streambot/pool/userbot-pool.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";
import { PlaybackChannelNumberSchema } from "@shepherdjerred/streambot/types/playback-channel.ts";
import { voiceDisabledStreamerParts } from "./fake-streamer-voice.ts";
import type { VoiceCloseInfo } from "@shepherdjerred/streambot/streamer/voice-close-source.ts";
import type {
  SessionHandle,
  SessionManagerDeps,
} from "@shepherdjerred/streambot/session/session-types.ts";

export const guildId = GuildIdSchema.parse("100000000000000001");
export const voiceChannelId = ChannelIdSchema.parse("100000000000000010");
export const otherChannel = ChannelIdSchema.parse("100000000000000011");
export const statusChannelId = ChannelIdSchema.parse("100000000000000020");
export const userId = UserIdSchema.parse("100000000000000099");
export const scope = { guildId, channelId: voiceChannelId, userId };
export const number = (value: number) =>
  PlaybackChannelNumberSchema.parse(value);
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
});

export async function harness(
  size = 3,
  overrides: Partial<SessionManagerDeps> = {},
): Promise<{
  manager: SessionManager;
  entries: UserbotEntry[];
  joins: Mock;
  disconnects: Mock;
  plays: { identity: string; transport: string }[];
  completions: (() => void)[];
  play: (
    value: number,
    channel?: typeof voiceChannelId,
    manager?: SessionManager,
  ) => SessionHandle;
  dir: string;
  closeListeners: Map<string, ((info: VoiceCloseInfo) => void) | null>;
  restart: () => SessionManager;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "numbered-streambot-"));
  const joins = vi.fn();
  const disconnects = vi.fn();
  const closeListeners = new Map<
    string,
    ((info: VoiceCloseInfo) => void) | null
  >();
  const plays: { identity: string; transport: string }[] = [];
  const completions: (() => void)[] = [];
  const entries: UserbotEntry[] = Array.from({ length: size }, (_, index) => {
    const identity = `account-${String(index)}`;
    let lastClose: VoiceCloseInfo | null = null;
    const makeLane = (): StreamerLike => ({
      ...voiceDisabledStreamerParts(),
      userId: () => identity,
      assistantUserId: () => identity,
      login: async () => {
        /* already logged in */
      },
      destroy: async () => {
        /* lane disposal */
      },
      guildIds: () => [guildId],
      joinVoice: (input) => {
        joins(identity);
        return Promise.resolve(input);
      },
      leaveVoice: async () => {
        /* child cannot disconnect its owner */
      },
      runStream: async (input, signal) => {
        plays.push({ identity, transport: input.resolved.mediaKind });
        if (!signal.aborted)
          await new Promise<void>((resolve) => {
            completions.push(resolve);
            signal.addEventListener(
              "abort",
              () => {
                resolve();
              },
              { once: true },
            );
          });
      },
      getPosition: () => 12,
      lastVoiceCloseInfo: () => lastClose,
      captureVoiceCloseSource: () => ({
        lastVoiceCloseInfo: () => lastClose,
        release: () => {
          /* no observer */
        },
      }),
      setVoiceCloseListener: (listener) => {
        closeListeners.set(
          identity,
          listener === null
            ? null
            : (info) => {
                lastClose = info;
                listener(info);
              },
        );
      },
      setStallListener: () => {
        /* transport fixture */
      },
    });
    const physical = makeLane();
    physical.createPlaybackHandle = () => makeLane();
    physical.leaveVoice = () => {
      disconnects(identity);
      return Promise.resolve();
    };
    return { userbot: physical, guildIds: new Set([guildId]), busy: false };
  });
  const pool: UserbotProvider = {
    acquire: () => {
      const entry = entries.find((candidate) => !candidate.busy);
      if (entry === undefined) return null;
      entry.busy = true;
      return entry;
    },
    release: (entry) => {
      entry.busy = false;
    },
    canServe: () => true,
    capacityFor: () => size,
    userIds: () => new Set(entries.map((entry) => entry.userbot.userId())),
  };
  const createManager = () =>
    new SessionManager({
      config: {
        ...loadConfig({
          BOT_TOKEN: "bot",
          USER_TOKENS: "user",
          VIDEOS_DIR: "/videos",
        }),
        state: { dir, resumeMaxAgeSeconds: 3600 },
      },
      pool,
      cards: {
        post: () => Promise.resolve("card"),
        edit: () => Promise.resolve("ok"),
        strip: async () => {
          /* no REST */
        },
        remove: async () => {
          /* no REST */
        },
        register: () => {
          /* route checked by instance below */
        },
        unregister: () => {
          /* no REST */
        },
      },
      announce: async () => {
        /* no external writes */
      },
      resolveSource: ({ source }) =>
        Promise.resolve({
          title: "Clip",
          ffmpegInput: "/clip",
          mediaKind: source.mode === "music" ? "music" : "video",
          chapters: [],
        }),
      featureGate: {
        numberedChannels: () => Promise.resolve(true),
        assistantV2: () => Promise.resolve(false),
        history: () => Promise.resolve(false),
        musicOverVoice: () => Promise.resolve(false),
      },
      ...overrides,
    });
  const manager = createManager();
  const managers = [manager];
  const restart = () => {
    const replacement = createManager();
    managers.push(replacement);
    return replacement;
  };
  cleanup.push(async () => {
    for (const active of managers) await active.destroyAll();
    await rm(dir, { recursive: true });
  });
  const play = (value: number, channel = voiceChannelId, target = manager) => {
    const handle = target.ensureForPlay({
      guildId,
      voiceChannelId: channel,
      statusChannelId,
      playbackChannel: number(value),
    });
    if (handle === null) throw new Error("No fixture account available");
    handle.dispatch({
      type: "ADD",
      requesterId: userId,
      source: {
        kind: "search",
        query: `clip-${String(value)}`,
        mode: value === 1 ? "music" : "video",
      },
    });
    return handle;
  };
  return {
    manager,
    entries,
    joins,
    disconnects,
    plays,
    completions,
    play,
    dir,
    closeListeners,
    restart,
  };
}
