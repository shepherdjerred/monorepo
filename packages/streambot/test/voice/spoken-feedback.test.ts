import { describe, expect, test } from "vitest";
import path from "node:path";
import { loadSpokenFeedbackClips } from "@shepherdjerred/streambot/voice/spoken-feedback.ts";

const ASSETS_DIR = path.join(import.meta.dir, "..", "..", "assets", "voice");

describe("spoken feedback clips", () => {
  test("the committed clips are valid 24 kHz mono PCM16 and non-trivial", async () => {
    const clips = await loadSpokenFeedbackClips(ASSETS_DIR);
    for (const clip of [clips.retry, clips.prompt]) {
      // At least half a second of audio, byte length even (16-bit samples), not all silence.
      expect(clip.length % 2).toBe(0);
      expect(clip.length).toBeGreaterThan(24_000);
      expect(clip.some((byte) => byte !== 0)).toBe(true);
    }
  });

  test("a wrong-rate clip is fatal, not degraded", async () => {
    // The keyword smoke WAV is 16 kHz — valid PCM16 mono, wrong rate for the reply sink.
    await expect(
      loadSpokenFeedbackClips(path.join(ASSETS_DIR, "test_wavs")),
    ).rejects.toThrow();
  });
});
