import { describe, expect, test } from "vitest";
import {
  SCOUT_DESKTOP_VOICE_MAX_WAV_BYTES,
  SCOUT_DESKTOP_VOICE_MIN_WAV_BYTES,
} from "@scout-for-lol/data";
import voiceFixture from "@scout-for-lol/data/scout-client/desktop-fixtures/coach-voice-turns.json" with { type: "json" };
import { encodePcm16MonoWave } from "@shepherdjerred/voice-assistant";
import { parseVoiceUtterance, proveVoiceInitiation } from "./voice-turn.ts";

const golden = new Uint8Array(
  Buffer.from(voiceFixture.request.audio.base64, "base64"),
);

/** `samples` mono samples at `rate`, as `encodePcm16MonoWave` writes them. */
function wav(samples: number, rate = 16_000): Uint8Array {
  return encodePcm16MonoWave(new Float32Array(samples).fill(0.25), rate);
}

describe("parseVoiceUtterance", () => {
  test("reads the golden utterance as 200 ms of 16 kHz samples", () => {
    const result = parseVoiceUtterance(golden);
    if (!result.ok) throw new Error(result.message);
    expect(result.utterance.durationMs).toBe(200);
    expect(result.utterance.pcm16k).toHaveLength(3200);
    expect(Math.max(...result.utterance.pcm16k)).toBeLessThan(1);
  });

  test("reads what the voice cascade's own encoder writes", () => {
    const result = parseVoiceUtterance(wav(16_000));
    if (!result.ok) throw new Error(result.message);
    expect(result.utterance.durationMs).toBe(1000);
    expect(result.utterance.pcm16k[0]).toBeCloseTo(0.25, 3);
  });

  test("takes exactly the longest utterance and nothing past it", () => {
    const longest = wav((SCOUT_DESKTOP_VOICE_MAX_WAV_BYTES - 44) / 2);
    expect(longest.byteLength).toBe(SCOUT_DESKTOP_VOICE_MAX_WAV_BYTES);
    expect(parseVoiceUtterance(longest).ok).toBe(true);
    expect(parseVoiceUtterance(wav(longest.byteLength / 2)).ok).toBe(false);
  });

  test("refuses anything shorter than speech", () => {
    const shortest = wav((SCOUT_DESKTOP_VOICE_MIN_WAV_BYTES - 44) / 2);
    expect(parseVoiceUtterance(shortest).ok).toBe(true);
    expect(parseVoiceUtterance(wav(100)).ok).toBe(false);
  });

  test.each<[string, (bytes: Uint8Array, view: DataView) => void]>([
    [
      "a sample rate other than 16 kHz",
      (_b, view) => view.setUint32(24, 48_000, true),
    ],
    ["two channels", (_b, view) => view.setUint16(22, 2, true)],
    ["8-bit samples", (_b, view) => view.setUint16(34, 8, true)],
    ["a compressed format", (_b, view) => view.setUint16(20, 3, true)],
    [
      "a RIFF size that disagrees with the file",
      (_b, view) => view.setUint32(4, 12, true),
    ],
    [
      "a data size that disagrees with the file",
      (_b, view) => view.setUint32(40, 12, true),
    ],
    [
      "a chunk other than data after fmt",
      (bytes) => bytes.set([76, 73, 83, 84], 36),
    ],
    ["not a RIFF file", (bytes) => bytes.set([79, 103, 103, 83], 0)],
  ])("refuses %s", (_reason, corrupt) => {
    const bytes = golden.slice();
    corrupt(bytes, new DataView(bytes.buffer));
    expect(parseVoiceUtterance(bytes).ok).toBe(false);
  });
});

describe("proveVoiceInitiation", () => {
  test.each([
    ["Hey Scout, what should I build next?", "what should i build next"],
    ["hey scout what's my gold lead", "what s my gold lead"],
    ["Hey Scott, how is bot lane doing?", "how is bot lane doing"],
  ])("a wake-word turn opening with the phrase asks %j", (heard, question) => {
    expect(proveVoiceInitiation(heard, "wake_word")).toEqual({
      ok: true,
      question,
      wake: "verified",
    });
  });

  test.each([
    "what should I build next?",
    "I said hey scout earlier",
    "scout, build?",
    "",
  ])("a wake-word turn without the phrase up front is refused: %j", (heard) => {
    expect(proveVoiceInitiation(heard, "wake_word")).toEqual({
      ok: false,
      code: "wake_not_verified",
    });
  });

  test("the wake phrase alone asks nothing", () => {
    expect(proveVoiceInitiation("Hey Scout.", "wake_word")).toEqual({
      ok: false,
      code: "empty_question",
    });
  });

  test("push-to-talk asks the whole transcript as heard", () => {
    expect(
      proveVoiceInitiation("  How far ahead are we in gold?  ", "push_to_talk"),
    ).toEqual({
      ok: true,
      question: "How far ahead are we in gold?",
      wake: "not_required",
    });
    expect(proveVoiceInitiation("   ", "push_to_talk")).toEqual({
      ok: false,
      code: "empty_question",
    });
  });
});
