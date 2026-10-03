import { describe, expect, test, vi } from "vitest";
import type { LocalVoiceModels } from "@shepherdjerred/voice-assistant";
import * as factory from "@shepherdjerred/streambot/session/voice-session-factory.ts";
import {
  harness,
  number,
  scope,
  guildId,
  voiceChannelId,
} from "./numbered-fixture.ts";

const models: LocalVoiceModels = {
  runtime: "native",
  createKeywordDetector: () => ({
    accept: vi.fn(() => null),
    reset: vi.fn(),
    close: vi.fn(),
  }),
  createVad: () => ({
    accept: vi.fn(),
    isSpeechActive: () => false,
    hasCompletedSpeech: () => false,
    flush: vi.fn(),
    reset: vi.fn(),
    close: vi.fn(),
  }),
  verifyWakePhrase: async () => ({ accepted: false, score: 0 }),
  close: async () => {
    /* no shared native assets */
  },
};

describe("numbered room assistant ownership", () => {
  test("helper ownership transfers to the primary only after the held turn drains", async () => {
    const create = vi.spyOn(factory, "createSessionVoiceAssistant");
    try {
      const h = await harness(2, {
        voiceModels: models,
        library: () => [],
        resolvePlaySource: async () => {
          throw new Error("No media request in this test");
        },
      });
      h.play(3);
      await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
      const helper = create.mock.calls[0]?.[1];
      const options = create.mock.calls[0]?.[2];
      if (helper?.voiceAssistant == null || options?.holdTeardown === undefined)
        throw new Error("Missing helper assistant");
      const close = vi.spyOn(helper.voiceAssistant, "close");
      const release = options.holdTeardown();
      h.play(2);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(create).toHaveBeenCalledTimes(1);
      expect(close).not.toHaveBeenCalled();
      release();
      await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
      expect(close).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[1]?.[1].playbackChannel).toBe(2);
      h.play(1);
      await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(3));
      expect(create.mock.calls[2]?.[1].playbackChannel).toBe(1);
      expect(
        h.manager.getExisting(guildId, voiceChannelId, number(3)),
      ).not.toBeNull();
    } finally {
      create.mockRestore();
    }
  });

  test("a captured selection survives later focus changes; an active room retains its rollout mode", async () => {
    const enabled = vi.fn(async () => true);
    const h = await harness(1, {
      featureGate: {
        numberedChannels: enabled,
        musicOverVoice: async () => false,
        assistantV2: async () => false,
        history: async () => false,
      },
    });
    const captured = h.manager.selectedChannel(scope);
    await h.manager.numbered.select(scope, 2);
    expect(await captured).toBe(1);
    h.play(2);
    enabled.mockResolvedValue(false);
    expect(await h.manager.selectedChannel(scope)).toBe(2);
    expect(() =>
      h.manager.ensureForPlay({
        guildId,
        voiceChannelId,
        statusChannelId: voiceChannelId,
      }),
    ).toThrow("changed to numbered playback");
  });
});
