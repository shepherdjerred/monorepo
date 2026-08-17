import { describe, expect, test } from "bun:test";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { DebugAudioRecorder } from "@shepherdjerred/streambot/voice/debug-audio-recorder.ts";

describe("DebugAudioRecorder", () => {
  test("writes lossless 24 kHz mono PCM16 WAV plus useful level diagnostics", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "streambot-audio-"));
    try {
      const pcm = new Uint8Array(4);
      const pcmView = new DataView(pcm.buffer);
      pcmView.setInt16(0, 16_384, true);
      pcmView.setInt16(2, -32_768, true);
      const recorder = new DebugAudioRecorder();
      recorder.accept(pcm);
      const output = path.join(directory, "trial.wav");
      const summary = await recorder.save(output);
      const wav = new Uint8Array(await Bun.file(output).arrayBuffer());
      const view = new DataView(wav.buffer);

      expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
      expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe("WAVE");
      expect(view.getUint16(22, true)).toBe(1);
      expect(view.getUint32(24, true)).toBe(24_000);
      expect(view.getUint16(34, true)).toBe(16);
      expect(view.getUint32(40, true)).toBe(4);
      expect(wav.subarray(44)).toEqual(pcm);
      expect(summary.path).toBe(output);
      expect(summary.durationSeconds).toBeCloseTo(2 / 24_000);
      expect(summary.peak).toBe(1);
      expect(summary.rms).toBeCloseTo(Math.sqrt(0.625));
      expect(() => recorder.accept(pcm)).toThrow("already closed");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rejects partial PCM samples and becomes unusable after close", () => {
    const recorder = new DebugAudioRecorder();
    expect(() => recorder.accept(new Uint8Array(1))).toThrow(
      "complete int16 samples",
    );
    recorder.close();
    expect(() => recorder.accept(new Uint8Array(2))).toThrow("already closed");
  });
});
