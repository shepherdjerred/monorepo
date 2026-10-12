import { describe, expect, test, vi } from "vitest";
import { StreambotStreamer } from "@shepherdjerred/streambot/streamer/streamer.ts";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import type { PlayerFactory } from "@shepherdjerred/streambot/streamer/streamer-types.ts";
import type { joinStreamerVoice } from "@shepherdjerred/streambot/streamer/join-voice.ts";
import { createVoiceCloseTracker } from "@shepherdjerred/streambot/streamer/voice-close-source.ts";
import {
  STREAMER_USER_TOKEN,
  STREAMER_VOICE,
  streamerEnv,
} from "./streamer-test-fixtures.ts";

describe("mic and Go Live on one physical streamer", () => {
  test("a late close from a retired connection cannot recover the next account lease", async () => {
    const joins: Parameters<typeof joinStreamerVoice>[0][] = [];
    const root = new StreambotStreamer(
      STREAMER_USER_TOKEN,
      loadConfig(streamerEnv()),
      Date.now,
      {
        joinStreamerVoice: async (options) => {
          joins.push(options);
          return createVoiceCloseTracker(() => {
            /* no network observer */
          });
        },
      },
    );
    const oldClose = vi.fn();
    const newClose = vi.fn();
    root.setVoiceCloseListener(oldClose);
    await root.joinVoice(STREAMER_VOICE);
    await root.leaveVoice({ voice: STREAMER_VOICE });
    root.setVoiceCloseListener(newClose);
    await root.joinVoice(STREAMER_VOICE);
    const info = { code: 4014, deliberate: true, atMs: Date.now() };
    joins[0]?.onClose?.(info);
    expect(newClose).not.toHaveBeenCalled();
    joins[1]?.onClose?.(info);
    expect(newClose).toHaveBeenCalledTimes(1);
    await root.destroy();
  });
  test.each(["music", "video"] as const)(
    "stopping %s preserves its sibling player and clock",
    async (stopped) => {
      const players: {
        connection: unknown;
        type: string | undefined;
        stop: ReturnType<typeof vi.fn>;
        seek: ReturnType<typeof vi.fn>;
      }[] = [];
      const factory: PlayerFactory = (connection, _input, options) => {
        let finish!: () => void;
        const finished = new Promise<void>((resolve) => {
          finish = resolve;
        });
        const stop = vi.fn(finish);
        const seek = vi.fn(async () => {
          /* independent pipeline replacement */
        });
        players.push({ connection, type: options?.play?.type, stop, seek });
        return {
          start: async () => {
            /* playback attached */
          },
          stop,
          seek,
          setVolume: async () => false,
          finished,
          position: 0,
        };
      };
      let now = 1000;
      const root = new StreambotStreamer(
        STREAMER_USER_TOKEN,
        loadConfig(streamerEnv()),
        () => now,
        factory,
      );
      const mic = root.createPlaybackHandle("music");
      const video = root.createPlaybackHandle("video");
      const run = (lane: typeof mic, mediaKind: "music" | "video") =>
        lane.runStream(
          {
            voice: STREAMER_VOICE,
            resolved: {
              title: mediaKind,
              mediaKind,
              ffmpegInput: "/fixture",
              chapters: [],
            },
            volume: mediaKind === "music" ? 25 : 80,
            pipelineMode: "sw",
            seekSeconds: 0,
          },
          new AbortController().signal,
        );
      const runs = [run(mic, "music"), run(video, "video")];
      await vi.waitFor(() => expect(mic.getPosition()).toBe(0));
      expect(players.map((player) => player.type)).toEqual([
        "voice",
        "go-live",
      ]);
      expect(players[0]?.connection).toBe(players[1]?.connection);
      await mic.seek(40);
      await video.seek(90);
      now += 2000;
      expect(mic.getPosition()).toBe(42);
      expect(video.getPosition()).toBe(92);
      await expect(video.setVolume(10)).resolves.toBe(false);
      await expect(mic.setVolume(30)).resolves.toBe(true);
      const ending = stopped === "music" ? mic : video;
      const sibling = stopped === "music" ? video : mic;
      await ending.leaveVoice(
        { voice: STREAMER_VOICE },
        new AbortController().signal,
      );
      expect(ending.getPosition()).toBeNull();
      expect(sibling.getPosition()).not.toBeNull();
      expect(players[stopped === "music" ? 1 : 0]?.stop).not.toHaveBeenCalled();
      await sibling.leaveVoice(
        { voice: STREAMER_VOICE },
        new AbortController().signal,
      );
      await Promise.all(runs);
      await root.destroy();
    },
  );
});
