import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { Demuxer } from "node-av";
import { demux } from "../src/media/LibavDemuxer.ts";
import { AVCodecID } from "../src/media/LibavCodecId.ts";

/**
 * The audio-only path's frametime, end to end, against a real ffmpeg-produced NUT.
 *
 * `attach-pipeline-audio.test.ts` proves the frametime PROPAGATES — it hands the pipeline packets
 * whose `duration` was written by hand. Nothing there proves where a real 20 ms comes from, and on
 * the music path the answer is one line: `packet.duration ||= BigInt(parseOpusPacketDuration(...))`
 * in LibavDemuxer. An audio-only NUT carries no per-packet duration at all, so that Opus TOC-byte
 * parse is the ONLY source of frametime for every 20 ms of music that plays.
 *
 * If it ever yields 0, `BaseMediaStream._write`'s `sleep = pts - startPts + frametime - elapsed`
 * collapses and the RTP timestamp stops advancing correctly: the pacer busy-spins and the audio
 * drifts. No fake-demuxer test can see that, and in production it surfaces only as "the music sounds
 * wrong" in a live listening session. Hence a real fixture.
 *
 * Like `node-av-native.integration.test.ts`, this fails loudly rather than skipping when the ffmpeg
 * binary is unavailable: `ffmpeg-static` is a pinned devDependency, so its absence is a broken
 * install, and a test that silently skips is exactly how this coverage would evaporate unnoticed.
 */

let fixtureDirectory = "";
let fixturePath = "";

/** 20 ms at 48 kHz, the unit `parseOpusPacketDuration` returns (48 samples/ms × 20 ms). */
const OPUS_FRAME_SAMPLES = 960n;

function runFfmpeg(args: string[]): void {
  if (ffmpegPath === null) throw new Error("unreachable: checked in beforeAll");
  const result = Bun.spawnSync([ffmpegPath, "-hide_banner", "-loglevel", "error", "-y", ...args]);
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to build the audio-only fixture: ${result.stderr.toString()}`,
    );
  }
}

beforeAll(async () => {
  if (ffmpegPath === null) {
    throw new Error(
      `ffmpeg-static does not provide a binary for ${process.platform}/${process.arch}`,
    );
  }

  fixtureDirectory = await mkdtemp(
    path.join(tmpdir(), "discord-video-stream-audio-only-"),
  );
  const sourcePath = path.join(fixtureDirectory, "source.m4a");
  fixturePath = path.join(fixtureDirectory, "music.nut");

  // A real encoded source first, so the NUT below is a genuine transcode rather than a synthetic
  // filter graph muxed straight out — the shape production actually feeds prepareStream.
  runFfmpeg([
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=3",
    "-c:a",
    "aac",
    sourcePath,
  ]);

  // Exactly the output vector `prepareStream({ audioOnly: true })` emits: no video mapping, the
  // REQUIRED `-map 0:a:0`, stereo 48 kHz libopus, the unity volume filter, into NUT.
  runFfmpeg([
    "-i",
    sourcePath,
    "-vn",
    "-map",
    "0:a:0",
    "-ac",
    "2",
    "-lfe_mix_level",
    "1",
    "-ar",
    "48000",
    "-c:a",
    "libopus",
    "-b:a",
    "128k",
    "-af",
    "volume@internal_lib=1.0",
    "-flush_packets",
    "1",
    "-f",
    "nut",
    fixturePath,
  ]);
});

afterAll(async () => {
  await rm(fixtureDirectory, { force: true, recursive: true });
});

describe("audio-only NUT frametime", () => {
  test("the container itself supplies no per-packet duration", async () => {
    // The precondition the TOC fallback exists to cover, pinned as an assertion rather than left
    // as a claim in a comment. If a future ffmpeg or muxer change started writing real durations,
    // this test would fail and tell us the fallback is no longer the thing under test — which is
    // information, not a nuisance.
    const demuxer = await Demuxer.open(fixturePath);
    const audio = demuxer.audio();
    if (!audio) {
      await demuxer.close();
      throw new Error("Generated fixture did not contain an audio stream");
    }

    const durations: bigint[] = [];
    const timestamps: bigint[] = [];
    try {
      for await (const packet of demuxer.packets(audio.index)) {
        if (packet === null) continue;
        durations.push(BigInt(packet.duration ?? 0));
        timestamps.push(BigInt(packet.pts ?? 0));
        packet.free();
      }
    } finally {
      await demuxer.close();
    }

    // ~3 s of 20 ms frames.
    expect(durations.length).toBeGreaterThan(100);
    // Not one packet carries a duration: every value is 0, so `||=` fires for all of them.
    expect(durations.every((duration) => duration === 0n)).toBe(true);
    // …while the presentation timestamps advance by exactly one 20 ms Opus frame, which is what
    // makes 960 the right answer for the parser to produce.
    const deltas = timestamps
      .slice(1)
      .map((pts, index) => pts - (timestamps[index] ?? 0n));
    expect(deltas.every((delta) => delta === OPUS_FRAME_SAMPLES)).toBe(true);
  });

  test("demux fills every packet's duration from the Opus TOC byte", async () => {
    const { video, audio } = await demux(createReadStream(fixturePath), {
      format: "nut",
    });

    // The audio-only shape LibavDemuxer reports, and the Opus-only codec its allowlist accepts.
    expect(video).toBeUndefined();
    expect(audio).toBeDefined();
    expect(audio?.codec).toBe(AVCodecID.AV_CODEC_ID_OPUS);
    expect(audio?.sample_rate).toBe(48_000);
    if (!audio) throw new Error("unreachable: asserted above");

    const durations: bigint[] = [];
    const frametimes: number[] = [];
    for await (const packet of audio.stream) {
      durations.push(BigInt(packet.duration));
      // Computed exactly as BaseMediaStream._write does, so this is the number the pacer and the
      // RTP timestamp advance actually see — not a proxy for it.
      frametimes.push(
        (Number(packet.duration) / packet.timeBase.den) *
          packet.timeBase.num *
          1000,
      );
      packet.free();
    }

    expect(durations.length).toBeGreaterThan(100);
    expect(durations.every((duration) => duration === OPUS_FRAME_SAMPLES)).toBe(
      true,
    );
    // The assertion the whole file exists for: a real music packet is 20 ms, not 0 and not
    // undefined. `new Set` keeps the failure message readable — it prints the distinct values seen.
    expect([...new Set(frametimes)]).toEqual([20]);
  });
});
