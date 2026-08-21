import { describe, expect, test } from "vitest";
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

  // A 440 Hz tone survives the 24k PCM16 → Opus → 16k float round-trip with its energy and
  // dominant frequency intact. The silence test above cannot catch a zeroed channel, an
  // interleave confusion, or a sample-rate mismatch (a 48k/16k confusion shifts the tone 3×);
  // this one fails on all three.
  test("a 440 Hz tone keeps its energy and pitch through the round-trip", () => {
    const encoder = new DiscordOpusEncoder();
    const decoder = new DiscordOpusDecoder();
    try {
      const inputRate = 24_000;
      const seconds = 0.4;
      const sampleCount = Math.round(inputRate * seconds);
      const input = new Uint8Array(sampleCount * 2);
      const view = new DataView(input.buffer);
      for (let index = 0; index < sampleCount; index += 1) {
        const value =
          0.5 * Math.sin((2 * Math.PI * 440 * index) / inputRate) * 32_767;
        view.setInt16(index * 2, Math.round(value), true);
      }
      const packets = [...encoder.encode(input), ...encoder.finish()];
      const decoded = packets.flatMap((packet) => [...decoder.decode(packet)]);
      expect(decoded.length).toBeGreaterThan(0);

      // Skip the codec's warm-up transient, then measure RMS energy.
      const outputRate = 16_000;
      const settled = decoded.slice(Math.round(outputRate * 0.05));
      const rms = Math.sqrt(
        settled.reduce((total, sample) => total + sample * sample, 0) /
          settled.length,
      );
      expect(rms).toBeGreaterThan(0.15);

      // Goertzel bin power: 440 Hz must dominate a neighborhood of competing bins.
      const power = (frequency: number): number => {
        const omega = (2 * Math.PI * frequency) / outputRate;
        const coefficient = 2 * Math.cos(omega);
        let previous = 0;
        let beforePrevious = 0;
        for (const sample of settled) {
          const current = sample + coefficient * previous - beforePrevious;
          beforePrevious = previous;
          previous = current;
        }
        return (
          previous * previous +
          beforePrevious * beforePrevious -
          coefficient * previous * beforePrevious
        );
      };
      const target = power(440);
      for (const competitor of [147, 220, 880, 1320, 2640]) {
        expect(target).toBeGreaterThan(power(competitor) * 4);
      }
    } finally {
      encoder.close();
      decoder.close();
    }
  });
});
