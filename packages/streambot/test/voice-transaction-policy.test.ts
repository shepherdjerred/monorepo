import { describe, expect, test } from "bun:test";
import {
  bindPlaybackVoiceCommandPort,
  createStreambotVoiceTools,
  VoiceMutationGate,
  voiceToolSchemas,
} from "@shepherdjerred/streambot/voice/voice-tools.ts";
import { PlaybackCommandService } from "@shepherdjerred/streambot/commands/playback-command-service.ts";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import { UserIdSchema } from "@shepherdjerred/streambot/types/ids.ts";

describe("voice transaction policy", () => {
  test("permits exactly one mutating operation", () => {
    const gate = new VoiceMutationGate();
    expect(gate.claim()).toBe(true);
    expect(gate.claim()).toBe(false);
    expect(gate.hasMutated).toBe(true);
  });

  test("release undoes a boundary-failed claim so a corrected retry can run", () => {
    const gate = new VoiceMutationGate();
    expect(gate.claim()).toBe(true);
    gate.release();
    expect(gate.hasMutated).toBe(false);
    expect(gate.claim()).toBe(true);
    expect(gate.claim()).toBe(false);
  });

  test("exposes only the bounded Streambot tool surface", () => {
    const service = new PlaybackCommandService({
      config: loadConfig({
        BOT_TOKEN: "bot",
        USER_TOKENS: "userbot",
        VIDEOS_DIR: "/videos",
      }),
      dispatch: (event) => event.type,
      view: () => ({
        current: null,
        queue: [],
        positionSeconds: null,
        state: "idle",
        loop: "off",
        volume: 100,
      }),
      library: () => [],
      setVolume: () => Promise.resolve(true),
      seek: () => Promise.resolve(true),
      resolvePlaySource: () => Promise.reject(new Error("unused")),
      announce: () => Promise.resolve(),
    });
    const tools = createStreambotVoiceTools(
      bindPlaybackVoiceCommandPort(
        service,
        UserIdSchema.parse("100000000000000001"),
      ),
      new VoiceMutationGate(),
    );
    expect(tools.map((item) => item.name)).toEqual([
      "play",
      "skip",
      "stop",
      "seek",
      "set_volume",
      "set_loop",
      "shuffle",
      "get_queue",
      "get_now_playing",
    ]);
  });

  test("validates every strict tool input schema", () => {
    expect(
      voiceToolSchemas.play.safeParse({
        query: "Local Movie",
        source: "auto",
        placement: "queue",
      }).success,
    ).toBe(true);
    expect(
      voiceToolSchemas.seek.safeParse({ seconds: -30, mode: "relative" })
        .success,
    ).toBe(true);
    expect(voiceToolSchemas.setVolume.safeParse({ percent: 200 }).success).toBe(
      true,
    );
    expect(voiceToolSchemas.setLoop.safeParse({ mode: "track" }).success).toBe(
      true,
    );
    for (const schema of [
      voiceToolSchemas.skip,
      voiceToolSchemas.stop,
      voiceToolSchemas.shuffle,
      voiceToolSchemas.getQueue,
      voiceToolSchemas.getNowPlaying,
    ]) {
      expect(schema.safeParse({}).success).toBe(true);
      expect(schema.safeParse({ unexpected: true }).success).toBe(false);
    }
    expect(
      voiceToolSchemas.play.safeParse({
        query: "Movie",
        source: "url",
        placement: "queue",
      }).success,
    ).toBe(false);
    expect(voiceToolSchemas.setVolume.safeParse({ percent: 201 }).success).toBe(
      false,
    );
  });
});
