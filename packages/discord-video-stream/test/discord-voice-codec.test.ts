import { describe, expect, test } from "bun:test";
import {
  DiscordOpusDecoder,
  DiscordOpusEncoder,
  wakePcmToOpenAiPcm,
} from "../src/media/DiscordVoiceCodec.ts";

describe("Discord voice codec", () => {
  test("encodes assistant PCM into Opus and decodes it to wake PCM", () => {
    const encoder = new DiscordOpusEncoder();
    const decoder = new DiscordOpusDecoder();
    try {
      const packets = [
        ...encoder.encode(new Uint8Array(960)),
        ...encoder.finish(),
      ];
      expect(packets.length).toBeGreaterThan(0);
      const decoded = packets.flatMap((packet) => [...decoder.decode(packet)]);
      expect(decoded.length).toBeGreaterThan(0);
      expect(decoded.every((sample) => Number.isFinite(sample))).toBe(true);
    } finally {
      encoder.close();
      decoder.close();
    }
  });

  test("resamples 16k float wake audio to 24k PCM16", () => {
    const pcm = wakePcmToOpenAiPcm(new Float32Array(1_600));
    expect(pcm.byteLength).toBeGreaterThanOrEqual(4_700);
    expect(pcm.byteLength).toBeLessThanOrEqual(4_900);
  });
});
