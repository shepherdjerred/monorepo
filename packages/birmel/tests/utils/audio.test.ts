import { describe, test, expect } from "bun:test";
import {
  DISCORD_AUDIO_FORMAT,
  WHISPER_AUDIO_FORMAT,
  calculateDurationMs,
  calculateByteLength,
  formatDuration,
  isValidAudioBuffer,
  createSilenceBuffer,
} from "../../src/utils/audio.js";

describe("audio utilities", () => {
  describe("audio format constants", () => {
    test("DISCORD_AUDIO_FORMAT has correct values", () => {
      expect(DISCORD_AUDIO_FORMAT.sampleRate).toBe(48000);
      expect(DISCORD_AUDIO_FORMAT.channels).toBe(2);
      expect(DISCORD_AUDIO_FORMAT.bitDepth).toBe(16);
    });

    test("WHISPER_AUDIO_FORMAT has correct values", () => {
      expect(WHISPER_AUDIO_FORMAT.sampleRate).toBe(16000);
      expect(WHISPER_AUDIO_FORMAT.channels).toBe(1);
      expect(WHISPER_AUDIO_FORMAT.bitDepth).toBe(16);
    });
  });

  describe("calculateDurationMs", () => {
    test("calculates duration for Discord format", () => {
      // 48000 Hz * 2 channels * 2 bytes = 192000 bytes per second
      const oneSecondBytes = 192000;
      const duration = calculateDurationMs(oneSecondBytes, DISCORD_AUDIO_FORMAT);
      expect(duration).toBeCloseTo(1000, 0);
    });

    test("calculates duration for Whisper format", () => {
      // 16000 Hz * 1 channel * 2 bytes = 32000 bytes per second
      const oneSecondBytes = 32000;
      const duration = calculateDurationMs(oneSecondBytes, WHISPER_AUDIO_FORMAT);
      expect(duration).toBeCloseTo(1000, 0);
    });

    test("handles partial seconds", () => {
      const halfSecondBytes = 96000; // 192000 / 2
      const duration = calculateDurationMs(halfSecondBytes, DISCORD_AUDIO_FORMAT);
      expect(duration).toBeCloseTo(500, 0);
    });

    test("handles zero bytes", () => {
      const duration = calculateDurationMs(0, DISCORD_AUDIO_FORMAT);
      expect(duration).toBe(0);
    });
  });

  describe("calculateByteLength", () => {
    test("calculates bytes for Discord format", () => {
      const bytes = calculateByteLength(1000, DISCORD_AUDIO_FORMAT);
      expect(bytes).toBe(192000);
    });

    test("calculates bytes for Whisper format", () => {
      const bytes = calculateByteLength(1000, WHISPER_AUDIO_FORMAT);
      expect(bytes).toBe(32000);
    });

    test("handles partial seconds", () => {
      const bytes = calculateByteLength(500, DISCORD_AUDIO_FORMAT);
      expect(bytes).toBe(96000);
    });

    test("handles zero duration", () => {
      const bytes = calculateByteLength(0, DISCORD_AUDIO_FORMAT);
      expect(bytes).toBe(0);
    });

    test("rounds up fractional bytes", () => {
      const bytes = calculateByteLength(1, DISCORD_AUDIO_FORMAT);
      expect(bytes).toBe(192); // Rounded up
    });
  });

  describe("formatDuration", () => {
    test("formats seconds only", () => {
      expect(formatDuration(1000)).toBe("1s");
      expect(formatDuration(45000)).toBe("45s");
    });

    test("formats minutes and seconds", () => {
      expect(formatDuration(60000)).toBe("1:00");
      expect(formatDuration(90000)).toBe("1:30");
      expect(formatDuration(125000)).toBe("2:05");
    });

    test("pads seconds with leading zero", () => {
      expect(formatDuration(61000)).toBe("1:01");
      expect(formatDuration(305000)).toBe("5:05");
    });

    test("handles zero duration", () => {
      expect(formatDuration(0)).toBe("0s");
    });

    test("handles sub-second duration", () => {
      expect(formatDuration(500)).toBe("0s");
    });
  });

  describe("isValidAudioBuffer", () => {
    test("returns true for valid buffer", () => {
      const buffer = Buffer.alloc(1000);
      expect(isValidAudioBuffer(buffer)).toBe(true);
    });

    test("returns false for empty buffer", () => {
      const buffer = Buffer.alloc(0);
      expect(isValidAudioBuffer(buffer)).toBe(false);
    });

    test("returns false for oversized buffer", () => {
      // 100MB is too large
      const buffer = Buffer.alloc(100_000_001);
      expect(isValidAudioBuffer(buffer)).toBe(false);
    });

    test("returns true for max valid size", () => {
      // Just under 100MB
      const buffer = Buffer.alloc(99_999_999);
      expect(isValidAudioBuffer(buffer)).toBe(true);
    });
  });

  describe("createSilenceBuffer", () => {
    test("creates buffer with correct size for Discord format", () => {
      const buffer = createSilenceBuffer(1000, DISCORD_AUDIO_FORMAT);
      expect(buffer.length).toBe(192000);
    });

    test("creates buffer with correct size for Whisper format", () => {
      const buffer = createSilenceBuffer(1000, WHISPER_AUDIO_FORMAT);
      expect(buffer.length).toBe(32000);
    });

    test("creates buffer filled with zeros", () => {
      const buffer = createSilenceBuffer(100, DISCORD_AUDIO_FORMAT);
      for (let i = 0; i < buffer.length; i++) {
        expect(buffer[i]).toBe(0);
      }
    });

    test("uses Discord format by default", () => {
      const buffer = createSilenceBuffer(1000);
      expect(buffer.length).toBe(192000);
    });
  });
});
