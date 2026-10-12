import { describe, expect, test, vi } from "vitest";
import { RunContext } from "@openai/agents";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import { PlaybackCommandService } from "@shepherdjerred/streambot/commands/playback-command-service.ts";
import type { PlaybackEvent } from "@shepherdjerred/streambot/machine/types.ts";
import { EMPTY_HANDLE } from "@shepherdjerred/streambot/session/session-types.ts";
import { PlaybackChannelNumberSchema } from "@shepherdjerred/streambot/types/playback-channel.ts";
import { UserIdSchema } from "@shepherdjerred/streambot/types/ids.ts";
import { VoiceMutationGate } from "@shepherdjerred/voice-assistant/mutation-gate.ts";
import {
  bindPlaybackVoiceCommandPort,
  createStreambotVoiceTools,
} from "@shepherdjerred/streambot/voice/voice-tools.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";

const userId = UserIdSchema.parse("100000000000000099");
function fixture(number: number) {
  const events: PlaybackEvent[] = [];
  const sources: Source[] = [];
  const select = vi.fn((_speaker: string, channel: number) =>
    Promise.resolve(`Selected ${String(channel)}`),
  );
  const service = new PlaybackCommandService({
    config: loadConfig({
      BOT_TOKEN: "bot",
      USER_TOKENS: "user",
      VIDEOS_DIR: "/videos",
    }),
    ...EMPTY_HANDLE,
    dispatch: (event) => {
      events.push(event);
    },
    library: () => [],
    playbackChannel: PlaybackChannelNumberSchema.parse(number),
    guildId: "100000000000000001",
    channelId: "100000000000000010",
    featureGate: {
      musicOverVoice: async () => false,
      assistantV2: async () => true,
      history: async () => false,
    },
    resolvePlaySource: async (source) => {
      sources.push(source);
      return {
        title: "Fixture",
        ffmpegInput: "/fixture",
        mediaKind: source.mode === "music" ? "music" : "video",
        chapters: [],
      };
    },
    announce: async () => {
      /* no external writes */
    },
    selectChannel: select,
    listChannels: async () => "Channel 1 Audio; Channel 2 Video",
  });
  return { service, events, sources, select };
}
const request = {
  query: "fixture title",
  source: "youtube",
  placement: "queue",
  userId,
} as const;
describe("numbered command routing", () => {
  test.each([1, 2, 3])(
    "selection %s forces transport even while the legacy music flag is off",
    async (number) => {
      const h = fixture(number);
      await h.service.play(request);
      expect(h.sources[0]?.mode).toBe(number === 1 ? "music" : "video");
      expect(h.events[0]).toMatchObject({
        type: "ADD",
        source: { mode: number === 1 ? "music" : "video" },
      });
    },
  );
  test("spoken watch cannot switch channel 1 to video", async () => {
    const h = fixture(1);
    await h.service.play({
      ...request,
      spoken: true,
      mode: "video",
      utterance: "watch fixture title",
    });
    expect(h.sources[0]?.mode).toBe("music");
    expect(h.select).not.toHaveBeenCalled();
  });
  test("a conflicting explicit mode is refused before resolving or queuing media", async () => {
    const h = fixture(1);
    await expect(h.service.play({ ...request, mode: "video" })).rejects.toThrow(
      "selected channel determines",
    );
    expect(h.sources).toHaveLength(0);
    expect(h.events).toHaveLength(0);
  });
  test("voice selection uses the trusted speaker and consumes the turn's one mutation", async () => {
    const h = fixture(1);
    const gate = new VoiceMutationGate();
    const tools = createStreambotVoiceTools(
      bindPlaybackVoiceCommandPort(h.service, userId),
      gate,
    );
    const select = tools.find((item) => item.name === "select_channel");
    const list = tools.find((item) => item.name === "list_channels");
    if (select === undefined || list === undefined)
      throw new Error("Missing numbered voice tools");
    const context = new RunContext({});
    expect(await list.invoke(context, "{}")).toContain("Channel 1");
    expect(gate.hasMutated).toBe(false);
    expect(await select.invoke(context, '{"channel":2}')).toContain(
      "Selected 2",
    );
    expect(h.select).toHaveBeenCalledWith(userId, 2);
    expect(await select.invoke(context, '{"channel":3}')).toContain(
      "one playback change",
    );
    expect(h.select).toHaveBeenCalledTimes(1);
  });
});
