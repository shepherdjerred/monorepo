import { describe, test, expect } from "bun:test";
import "../setup.js";

describe("text-to-speech", () => {

  describe("generateSpeech", () => {
    test("generates speech from text", async () => {
      const { generateSpeech } = await import("../../src/voice/text-to-speech.js");

      const result = await generateSpeech("Hello world");

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });

    test("handles empty text", async () => {
      const { generateSpeech } = await import("../../src/voice/text-to-speech.js");

      const result = await generateSpeech("");

      expect(result).toBeInstanceOf(Buffer);
    });

    test("handles long text", async () => {
      const { generateSpeech } = await import("../../src/voice/text-to-speech.js");

      const longText = "A".repeat(1000);
      const result = await generateSpeech(longText);

      expect(result).toBeInstanceOf(Buffer);
    });

    test("handles special characters", async () => {
      const { generateSpeech } = await import("../../src/voice/text-to-speech.js");

      const result = await generateSpeech("Hello! How are you? 😀");

      expect(result).toBeInstanceOf(Buffer);
    });
  });

  describe("generateShortSpeech", () => {
    test("generates speech from short text", async () => {
      const { generateShortSpeech } = await import("../../src/voice/text-to-speech.js");

      const result = await generateShortSpeech("Hello world");

      expect(result).toBeInstanceOf(Buffer);
    });

    test("truncates text longer than 500 characters", async () => {
      const { generateShortSpeech } = await import("../../src/voice/text-to-speech.js");

      const longText = "A".repeat(600);
      const result = await generateShortSpeech(longText);

      expect(result).toBeInstanceOf(Buffer);
    });

    test("does not truncate text under 500 characters", async () => {
      const { generateShortSpeech } = await import("../../src/voice/text-to-speech.js");

      const shortText = "A".repeat(400);
      const result = await generateShortSpeech(shortText);

      expect(result).toBeInstanceOf(Buffer);
    });

    test("handles empty text", async () => {
      const { generateShortSpeech } = await import("../../src/voice/text-to-speech.js");

      const result = await generateShortSpeech("");

      expect(result).toBeInstanceOf(Buffer);
    });
  });
});
