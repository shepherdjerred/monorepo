import { describe, expect, test } from "vitest";
import {
  DiscordOpusDecoder,
  DiscordOpusEncoder,
  DiscordOpusFrameDecoder,
  DiscordOpusFrameEncoder,
  wakePcmToOpenAiPcm,
} from "@shepherdjerred/voice-assistant";

function stereoTone(frames: number, leftHz: number, rightHz: number) {
  const samples = new Float32Array(frames * 960 * 2);
  for (let index = 0; index < frames * 960; index += 1) {
    const t = index / 48_000;
    samples[index * 2] = 0.5 * Math.sin(2 * Math.PI * leftHz * t);
    samples[index * 2 + 1] = 0.5 * Math.sin(2 * Math.PI * rightHz * t);
  }
  return samples;
}

function channelPower(
  samples: Float32Array,
  channel: 0 | 1,
  frequency: number,
): number {
  const omega = (2 * Math.PI * frequency) / 48_000;
  const coefficient = 2 * Math.cos(omega);
  let previous = 0;
  let beforePrevious = 0;
  for (let index = channel; index < samples.length; index += 2) {
    const current =
      (samples[index] ?? 0) + coefficient * previous - beforePrevious;
    beforePrevious = previous;
    previous = current;
  }
  return (
    previous * previous +
    beforePrevious * beforePrevious -
    coefficient * previous * beforePrevious
  );
}

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
    const pcm = wakePcmToOpenAiPcm(new Float32Array(1600));
    expect(pcm.byteLength).toBeGreaterThanOrEqual(4700);
    expect(pcm.byteLength).toBeLessThanOrEqual(4900);
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

/**
 * The 48 kHz stereo pair, used to modify audio that is already on the wire (gain, mixing) and put
 * it straight back. Distinct from the assistant pair above, which resamples to and from the wake
 * detector's 16 kHz mono and OpenAI's 24 kHz PCM16 — those tests continue to pin that behavior
 * unchanged.
 */
describe("Discord 48kHz stereo frame codec", () => {
  /** Interleaved [L, R, L, R, …] with a different tone per channel. */

  /** Goertzel bin power of one channel of an interleaved stereo buffer. */

  test("emits exactly one packet per whole 20 ms frame and buffers a partial one", () => {
    const encoder = new DiscordOpusFrameEncoder(128_000);
    try {
      // One frame in, one packet out is what a mixer sitting in the send path needs: any other
      // ratio breaks the 1:1 correspondence the RTP timestamp advance assumes.
      expect(encoder.encode(new Float32Array(960 * 2))).toHaveLength(1);
      expect(encoder.encode(new Float32Array(960 * 2))).toHaveLength(1);
      // A partial frame is held back rather than padded mid-stream.
      expect(encoder.encode(new Float32Array(480 * 2))).toHaveLength(0);
      // …and flushed, padded with silence, only at the end.
      expect(encoder.finish().length).toBeGreaterThan(0);
    } finally {
      encoder.close();
    }
  });

  test("round-trips a stereo tone at 48 kHz with the channels intact", () => {
    const encoder = new DiscordOpusFrameEncoder(128_000);
    const decoder = new DiscordOpusFrameDecoder();
    try {
      const frames = 25; // 500 ms
      const packets = [
        ...encoder.encode(stereoTone(frames, 440, 1200)),
        ...encoder.finish(),
      ];
      expect(packets).toHaveLength(frames + 1);

      const decoded = packets.map((packet) => decoder.decode(packet));
      // Every packet decodes to one 20 ms stereo frame: 960 samples per channel, interleaved.
      for (const block of decoded.slice(0, frames)) {
        expect(block.length).toBe(960 * 2);
      }

      // Skip the codec warm-up, then confirm each channel kept its own tone. This fails on a
      // zeroed channel, on an interleave confusion (the tones would swap), and on a sample-rate
      // mismatch (a 24k/48k confusion moves each detected tone by a factor of two).
      const settled = decoded
        .slice(5, frames)
        .reduce<number[]>((all, block) => {
          all.push(...block);
          return all;
        }, []);
      const samples = new Float32Array(settled);
      expect(channelPower(samples, 0, 440)).toBeGreaterThan(
        channelPower(samples, 0, 1200) * 4,
      );
      expect(channelPower(samples, 1, 1200)).toBeGreaterThan(
        channelPower(samples, 1, 440) * 4,
      );
      expect(channelPower(samples, 0, 880)).toBeLessThan(
        channelPower(samples, 0, 440) / 4,
      );

      // Absolute level, not only the ratios above. Every power comparison so far is scale-free, so
      // a gain fault that attenuated both channels uniformly — the exact class of bug this codec
      // pair exists to serve, since a mixer multiplies these samples — would leave all of them
      // intact while making the track inaudible.
      const channelRms = (channel: 0 | 1): number => {
        let total = 0;
        let count = 0;
        for (let index = channel; index < samples.length; index += 2) {
          total += (samples[index] ?? 0) ** 2;
          count += 1;
        }
        return Math.sqrt(total / count);
      };
      // A 0.5-amplitude sine has an RMS of ~0.354; Opus at 128 kbps stays near it.
      expect(channelRms(0)).toBeGreaterThan(0.2);
      expect(channelRms(1)).toBeGreaterThan(0.2);
    } finally {
      encoder.close();
      decoder.close();
    }
  });

  test("rejects PCM that is not whole stereo samples", () => {
    const encoder = new DiscordOpusFrameEncoder(128_000);
    try {
      expect(() => encoder.encode(new Float32Array(961))).toThrow(
        /both channels/,
      );
    } finally {
      encoder.close();
    }
  });

  test("rejects a bit rate that is not a usable one", () => {
    expect(() => new DiscordOpusFrameEncoder(0)).toThrow(
      /Invalid Opus bit rate/,
    );
    expect(() => new DiscordOpusFrameEncoder(-1)).toThrow(
      /Invalid Opus bit rate/,
    );
    expect(() => new DiscordOpusFrameEncoder(1.5)).toThrow(
      /Invalid Opus bit rate/,
    );
  });

  test("honors the bit rate it was constructed with", () => {
    const input = stereoTone(50, 440, 1200);
    const encodedBytes = (bitRate: number): number => {
      const encoder = new DiscordOpusFrameEncoder(bitRate);
      try {
        return [...encoder.encode(input), ...encoder.finish()].reduce(
          (total, packet) => total + packet.byteLength,
          0,
        );
      } finally {
        encoder.close();
      }
    };
    // One second of the same audio at 24 kbps against 128 kbps. The ratio is nowhere near exact
    // (libopus is VBR and a pure tone is trivially compressible), so this asserts that the
    // constructor argument reaches the encoder at all — which a hardcoded 64 kbps would not.
    expect(encodedBytes(128_000)).toBeGreaterThan(encodedBytes(24_000) * 2);
  });
});
