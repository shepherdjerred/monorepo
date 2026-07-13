// Integration test for the Go-Live audio path.
//
// Feeds synthetic Float32 PCM (a 440 Hz sine tone) through the real
// `createAudioTransport` + real `prepareStream` + real `ffmpeg` and asserts:
//
//   1. The muxed NUT output contains an opus stream with > 0 packets.
//   2. Decoding the opus back to PCM yields a non-silent signal.
//
// This is the transport-side counterpart to `audio-fingerprint.test.ts`:
// where that one proves the wasm produces correct audio at the source,
// THIS one proves whatever the wasm produces survives the full
// transport → mux → opus encode pipeline and lands on the broadcast wire.
// Together they cover both halves of "audio reaches Discord."
//
// Mirrors the structure of `discord-plays-mario-kart`'s `scripts/e2e-audio.ts`
// synthetic mode, adapted to Pokemon's Float32 / 13379 Hz format. Run
// automatically in `bun test`; needs `ffmpeg` + `ffprobe` on PATH (the harness
// already requires them, so this is no new dep). Skip with
// `SKIP_AUDIO_STREAM_INTEGRATION=1` if those tools aren't available.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareStream, Encoders } from "@shepherdjerred/discord-video-stream";
import {
  AUDIO_CHANNELS,
  AUDIO_SAMPLE_RATE,
  GBA_FPS,
  HEIGHT,
  WIDTH,
} from "#src/emulator/constants.ts";
import { createAudioTransport } from "#src/stream/audio-transport.ts";

const NUT_PATH = path.join(tmpdir(), "dpp-audio-stream-test.nut");

/** Build N seconds of a 440 Hz Float32 stereo sine tone. */
function syntheticSine(seconds: number, hz = 440, amplitude = 0.5): Buffer {
  const frames = Math.round(AUDIO_SAMPLE_RATE * seconds);
  const buf = Buffer.alloc(frames * AUDIO_CHANNELS * 4);
  for (let i = 0; i < frames; i++) {
    const v = Math.sin((2 * Math.PI * hz * i) / AUDIO_SAMPLE_RATE) * amplitude;
    buf.writeFloatLE(v, i * 8);
    buf.writeFloatLE(v, i * 8 + 4);
  }
  return buf;
}

/** RMS of interleaved s16le PCM — what ffmpeg decodes the opus back to. */
function rmsS16(pcm: Buffer): number {
  if (pcm.byteLength < 2) return 0;
  const samples = Math.floor(pcm.byteLength / 2);
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const s = pcm.readInt16LE(i * 2);
    sum += s * s;
  }
  return Math.sqrt(sum / samples);
}

/** Drive the same `prepareStream` configuration `game-streamer.ts` uses with
 * the provided PCM (and a matching number of grey video frames) — collect the
 * NUT output into a temp file, return the path. */
async function renderBroadcast(pcm: Buffer): Promise<string> {
  const transport = await createAudioTransport();
  const video = new PassThrough();
  const { output, promise } = prepareStream(video, {
    width: WIDTH,
    height: HEIGHT,
    frameRate: GBA_FPS,
    videoCodec: "H264",
    bitrateVideo: 1000,
    bitrateVideoMax: 1500,
    includeAudio: true,
    audioInput: {
      source: transport.source,
      inputOptions: transport.inputOptions,
    },
    bitrateAudio: 96,
    minimizeLatency: true,
    customInputOptions: [
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "-video_size",
      `${String(WIDTH)}x${String(HEIGHT)}`,
      "-framerate",
      String(GBA_FPS),
    ],
    encoder: Encoders.software({
      x264: { preset: "ultrafast", tune: "zerolatency" },
    }),
  });

  const writer = Bun.file(NUT_PATH).writer();
  output.on("data", (chunk: Buffer) => {
    void writer.write(chunk);
  });

  transport.sink.write(pcm);
  transport.sink.end();
  // Push a matching run of grey frames so ffmpeg has video to mux against
  // (rawvideo's pts derives from the input framerate, so the frame count
  // and audio duration should track).
  const seconds = pcm.byteLength / (AUDIO_SAMPLE_RATE * AUDIO_CHANNELS * 4);
  const frames = Math.max(1, Math.ceil(seconds * GBA_FPS));
  const frame = Buffer.alloc(WIDTH * HEIGHT * 4, 0x80);
  for (let i = 0; i < frames; i++) video.write(frame);
  video.end();

  await promise.catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    // prepareStream's ffmpeg exits with a non-zero status on SIGKILL / normal
    // EOF — those don't indicate a failed mux. Re-throw anything else.
    if (!/SIGKILL|signal 9|Exiting normally|code (?:0|255)/i.test(message)) {
      throw error;
    }
  });
  await writer.end();
  transport.close();
  return NUT_PATH;
}

function audioPacketCount(nut: string): number {
  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "a",
      "-show_entries",
      "stream=codec_name,nb_read_packets",
      "-count_packets",
      "-of",
      "csv=p=0",
      nut,
    ],
    { encoding: "utf8" },
  );
  const line = probe.stdout.trim();
  if (!line.includes("opus")) return 0;
  const count = Number(line.split(",").at(-1));
  return Number.isFinite(count) ? count : 0;
}

function decodedRms(nut: string): number {
  const dec = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      nut,
      "-map",
      "0:a:0",
      "-f",
      "s16le",
      "-ac",
      String(AUDIO_CHANNELS),
      "-ar",
      String(AUDIO_SAMPLE_RATE),
      "-",
    ],
    { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 /* bytes */ },
  );
  return rmsS16(Buffer.from(dec.stdout));
}

function haveTools(): boolean {
  for (const tool of ["ffmpeg", "ffprobe"]) {
    const r = spawnSync(tool, ["-version"], { encoding: "utf8" });
    if (r.status !== 0) return false;
  }
  return true;
}

// Gate only on tool availability (ffmpeg/ffprobe) or an explicit env opt-out.
// When the tools are present the test runs for real; `skipIf` keeps CI green on
// hosts without ffmpeg without ever unconditionally skipping.
const SKIP = Bun.env.SKIP_AUDIO_STREAM_INTEGRATION === "1" || !haveTools();

describe.skipIf(SKIP)(
  "audio stream integration vs synthetic Float32 input",
  () => {
    test("440 Hz sine survives transport + prepareStream + libopus encode", async () => {
      const inputPcm = syntheticSine(1.5);
      const nut = await renderBroadcast(inputPcm);

      const packets = audioPacketCount(nut);
      expect(packets).toBeGreaterThan(0);

      const outRms = decodedRms(nut);
      // Decoded s16le; a 440 Hz sine at ±0.5 in should produce ~5000+ RMS
      // out of int16 (~16384 ~ peak). We assert a comfortable floor that
      // would still fail loud on silence.
      expect(outRms).toBeGreaterThan(500);
    }, 60_000);
  },
);
