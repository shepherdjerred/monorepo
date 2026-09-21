import { describe, expect, test } from "vitest";
import path from "node:path";
import { loadSpokenFeedbackClips } from "@shepherdjerred/voice-assistant/spoken-feedback.ts";
import {
  NOOP_VOICE_ATTEMPT_OBSERVER,
  type VoiceAttemptHandle,
} from "@shepherdjerred/voice-assistant/realtime/attempt.ts";
import { VOICE_FEEDBACK_CLIP_FILES } from "@shepherdjerred/streambot/voice/constants.ts";
import { speakClip } from "@shepherdjerred/streambot/voice/realtime-voice.ts";

const ASSETS_DIR = path.join(import.meta.dir, "..", "..", "assets", "voice");

describe("spoken feedback clips", () => {
  test("the committed clips are valid 24 kHz mono PCM16 and non-trivial", async () => {
    const clips = await loadSpokenFeedbackClips(
      ASSETS_DIR,
      VOICE_FEEDBACK_CLIP_FILES,
    );
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
      loadSpokenFeedbackClips(
        path.join(ASSETS_DIR, "test_wavs"),
        VOICE_FEEDBACK_CLIP_FILES,
      ),
    ).rejects.toThrow();
  });

  test("records a locally spoken clip onto the attempt reply capture", async () => {
    const clip = new Uint8Array(960);
    clip[0] = 7;
    let pcm24k: Uint8Array | undefined;
    const packets: Uint8Array[] = [];
    const attempt: VoiceAttemptHandle = {
      ...NOOP_VOICE_ATTEMPT_OBSERVER.begin(),
      reply: (input) => {
        pcm24k = input.pcm24k;
      },
    };
    await speakClip(
      {
        setAssistantSpeaking: () => Promise.resolve(),
        sendAssistantOpus: (packet) => {
          packets.push(packet);
        },
      },
      clip,
      attempt,
    );
    expect(pcm24k).toEqual(clip);
    expect(packets.length).toBeGreaterThan(0);
  });
});
