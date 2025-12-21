import { describe, test, expect } from "bun:test";
import "../setup.js";

describe("speech-to-text", () => {

  describe("transcribeAudio", () => {
    test("transcribes audio buffer to text", async () => {
      const { transcribeAudio } = await import("../../src/voice/speech-to-text.js");

      const audioBuffer = Buffer.from("fake audio data");
      const result = await transcribeAudio(audioBuffer);

      expect(result).toBe("test transcription");
    });

    test("handles empty audio buffer", async () => {
      const { transcribeAudio } = await import("../../src/voice/speech-to-text.js");

      const audioBuffer = Buffer.alloc(0);
      const result = await transcribeAudio(audioBuffer);

      expect(result).toBe("test transcription");
    });

    test("handles large audio buffer", async () => {
      const { transcribeAudio } = await import("../../src/voice/speech-to-text.js");

      // Simulate a larger audio buffer (100KB)
      const audioBuffer = Buffer.alloc(100000);
      const result = await transcribeAudio(audioBuffer);

      expect(result).toBe("test transcription");
    });

    test("returns string type", async () => {
      const { transcribeAudio } = await import("../../src/voice/speech-to-text.js");

      const audioBuffer = Buffer.from("audio");
      const result = await transcribeAudio(audioBuffer);

      expect(typeof result).toBe("string");
    });
  });
});
