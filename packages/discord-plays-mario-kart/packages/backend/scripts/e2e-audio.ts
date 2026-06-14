// Manual e2e for the Go-Live audio path.
//
// Two modes — only the second is a real end-to-end test:
//
//   - synthetic (default): an INTEGRATION test for the transport + codec. Feeds a
//     generated sine tone through the real createAudioTransport + real prepareStream
//     + real ffmpeg and asserts the muxed NUT has a non-empty opus track that
//     round-trips back to non-silent PCM. Proves the muxing works; says nothing
//     about whether the real emulator can drive it. Needs only ffmpeg/ffprobe.
//
//   - --rom [path]: the REAL end-to-end test. Boots the headless MK64 emulator,
//     drains real game audio via onAudio for ~20 s of game time, runs it through
//     the same production pipeline, and writes three artifacts a human can
//     actually LISTEN to in order to confirm MK64 sounds like MK64:
//
//       /tmp/mk64-audio-raw.wav      — raw PCM drained from the emulator
//       /tmp/mk64-audio.nut          — the muxed broadcast container (play with mpv/VLC)
//       /tmp/mk64-audio-decoded.wav  — the opus output round-tripped to WAV
//
//     Requires the built wasm core (bun run --cwd packages/backend build:wasm) and
//     the MK64 ROM. Never runs in CI (ROM is copyrighted, same convention as
//     e2e:scenario and e2e:race).
//
// Usage:
//   bun run e2e:audio                 # synthetic only (integration)
//   bun run e2e:audio --rom           # synthetic + real emulator (full e2e)
//   bun run e2e:audio --rom /path.z64
//
// Exits non-zero on any failed assertion.
import { spawnSync } from "node:child_process";
import { PassThrough } from "node:stream";
import { prepareStream, Encoders } from "@shepherdjerred/discord-video-stream";
import { createAudioTransport } from "#src/stream/audio-transport.ts";
import {
  WIDTH,
  HEIGHT,
  N64_FPS,
  AUDIO_SAMPLE_RATE,
  AUDIO_CHANNELS,
} from "#src/emulator/constants.ts";
import { bootEmulator, resolveRom } from "./lib/harness.ts";

const TMP_NUT = "/tmp/mk64-audio.nut";
const TMP_RAW_WAV = "/tmp/mk64-audio-raw.wav";
const TMP_DECODED_WAV = "/tmp/mk64-audio-decoded.wav";

const out = (s: string): void => {
  process.stdout.write(`${s}\n`);
};
const err = (s: string): void => {
  process.stderr.write(`${s}\n`);
};

function requireBinary(name: string): void {
  const r = spawnSync(name, ["-version"], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`${name} is required for the audio e2e but was not found`);
  }
}

/** RMS amplitude of interleaved s16le PCM (0 == pure silence). */
function rms(pcm: Buffer): number {
  if (pcm.byteLength < 2) return 0;
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let sumSquares = 0;
  const samples = Math.floor(pcm.byteLength / 2);
  for (let i = 0; i < samples; i++) {
    const s = view.getInt16(i * 2, true);
    sumSquares += s * s;
  }
  return Math.sqrt(sumSquares / samples);
}

/**
 * Run `pcm` + matching grey video through the real transport + prepareStream and
 * return the muxed NUT path. Mirrors GameStreamer.buildEncoder's options.
 */
async function renderBroadcast(pcm: Buffer): Promise<string> {
  const transport = await createAudioTransport();
  const video = new PassThrough();

  const { output, promise } = prepareStream(video, {
    width: WIDTH,
    height: HEIGHT,
    frameRate: N64_FPS,
    videoCodec: "H264",
    bitrateVideo: 1000,
    bitrateVideoMax: 1500,
    includeAudio: true,
    audioInput: {
      source: transport.source,
      inputOptions: transport.inputOptions,
    },
    minimizeLatency: true,
    customInputOptions: [
      "-f",
      "rawvideo",
      "-pix_fmt",
      "bgra",
      "-video_size",
      `${String(WIDTH)}x${String(HEIGHT)}`,
      "-framerate",
      String(N64_FPS),
    ],
    encoder: Encoders.software({
      x264: { preset: "ultrafast", tune: "zerolatency" },
    }),
  });

  const writer = Bun.file(TMP_NUT).writer();
  output.on("data", (chunk: Buffer) => {
    void writer.write(chunk);
  });

  // Feed audio (graceful end so ffmpeg drains it) + a matching run of grey frames.
  transport.sink.write(pcm);
  transport.sink.end();
  const seconds = pcm.byteLength / (AUDIO_SAMPLE_RATE * AUDIO_CHANNELS * 2);
  const frames = Math.max(1, Math.ceil(seconds * N64_FPS));
  const frame = Buffer.alloc(WIDTH * HEIGHT * 4, 0x80);
  for (let i = 0; i < frames; i++) video.write(Buffer.from(frame));
  video.end();

  await promise.catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (!/SIGKILL|signal 9|Exiting normally|code (?:0|255)/i.test(message)) {
      throw error;
    }
  });
  await writer.end();
  transport.close();
  return TMP_NUT;
}

/** ffprobe the NUT: returns the opus audio stream's packet count (0 if none). */
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

/** Decode the muxed audio back to PCM and return its RMS (proves it's non-silent). */
function decodedAudioRms(nut: string): number {
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
    // 256 MiB; long PCM decodes easily exceed the default 1 MiB buffer.
    { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 /* bytes */ },
  );
  return rms(Buffer.from(dec.stdout));
}

/** Wrap raw s16le stereo @ 44.1 kHz PCM in a WAV file (via ffmpeg, no manual header). */
function writeWavFromPcm(pcm: Buffer, path: string): void {
  const ff = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-f",
      "s16le",
      "-ar",
      String(AUDIO_SAMPLE_RATE),
      "-ac",
      String(AUDIO_CHANNELS),
      "-i",
      "pipe:0",
      path,
    ],
    { input: pcm, encoding: "buffer" },
  );
  if (ff.status !== 0) {
    throw new Error(
      `ffmpeg failed to write ${path}: ${ff.stderr.toString("utf8")}`,
    );
  }
}

/** Decode the muxed NUT's opus track straight to a WAV file. */
function decodeNutToWav(nut: string, path: string): void {
  const ff = spawnSync(
    "ffmpeg",
    ["-y", "-v", "error", "-i", nut, "-map", "0:a:0", path],
    { encoding: "buffer" },
  );
  if (ff.status !== 0) {
    throw new Error(
      `ffmpeg failed to decode ${nut} -> ${path}: ${ff.stderr.toString("utf8")}`,
    );
  }
}

function assert(cond: boolean, message: string): void {
  if (!cond) {
    err(`x ${message}`);
    process.exit(1);
  }
  out(`ok ${message}`);
}

// 1.5 s of a 440 Hz sine, s16le stereo — clearly non-silent input audio.
function syntheticTone(seconds: number): Buffer {
  const totalFrames = Math.round(AUDIO_SAMPLE_RATE * seconds);
  const buf = Buffer.alloc(totalFrames * AUDIO_CHANNELS * 2);
  for (let i = 0; i < totalFrames; i++) {
    const v = Math.round(
      Math.sin((2 * Math.PI * 440 * i) / AUDIO_SAMPLE_RATE) * 12_000,
    );
    buf.writeInt16LE(v, i * AUDIO_CHANNELS * 2);
    buf.writeInt16LE(v, i * AUDIO_CHANNELS * 2 + 2);
  }
  return buf;
}

async function runSynthetic(): Promise<void> {
  out("\n== synthetic mode (transport + prepareStream + ffmpeg) ==");
  const inputPcm = syntheticTone(1.5);
  const inputRms = rms(inputPcm);
  assert(
    inputRms > 500,
    `synthetic input PCM is non-silent (rms=${inputRms.toFixed(0)})`,
  );

  const nut = await renderBroadcast(inputPcm);
  const packets = audioPacketCount(nut);
  assert(
    packets > 0,
    `NUT carries an opus audio stream (${String(packets)} packets)`,
  );

  const outRms = decodedAudioRms(nut);
  assert(
    outRms > 200,
    `muxed audio is non-silent after opus round-trip (rms=${outRms.toFixed(0)})`,
  );
}

async function runRom(romArg: string | undefined): Promise<void> {
  out("\n== rom mode (real emulator audio through the pipeline) ==");
  const rom = await resolveRom(romArg);
  const wasm = `${Bun.env.WASM_DIR ?? "assets/n64wasm"}/n64wasm.wasm`;
  if (!(await Bun.file(wasm).exists())) {
    throw new Error(
      `rom mode needs the built wasm core at ${wasm} (run: bun run --cwd packages/backend build:wasm)`,
    );
  }

  const emu = await bootEmulator({ rom, seats: 1 });
  const chunks: Buffer[] = [];
  emu.onAudio((pcm) => {
    chunks.push(pcm);
  });

  // ~1200 wasm frames at the N64's ~30 fps = ~40 s of game time, enough to cover
  // the Nintendo/N64 splash logos and the title-screen jingle. The harness boots
  // the emulator in sprint mode (fps:1000) so this completes in a few seconds of
  // wall clock.
  const TARGET_FRAMES = 1200;
  await new Promise<void>((resolve) => {
    let frame = 0;
    emu.onFrame(() => {
      frame++;
      if (frame >= TARGET_FRAMES) {
        emu.stop();
        resolve();
      }
    });
    emu.start();
  });

  const realPcm = Buffer.concat(chunks);
  out(
    `drained ${String(chunks.length)} chunks, ${String(realPcm.byteLength)} bytes`,
  );
  assert(realPcm.byteLength > 0, "emulator produced audio samples via onAudio");
  const realRms = rms(realPcm);
  assert(
    realRms > 20,
    `real game audio is non-silent (rms=${realRms.toFixed(0)})`,
  );

  // Persist what the emulator actually produced BEFORE any encoding, so the user
  // can A/B compare the raw and decoded artifacts if the round-trip sounds off.
  writeWavFromPcm(realPcm, TMP_RAW_WAV);

  const nut = await renderBroadcast(realPcm);
  const packets = audioPacketCount(nut);
  assert(
    packets > 0,
    `real audio muxes into an opus stream (${String(packets)} packets)`,
  );
  const outRms = decodedAudioRms(nut);
  assert(
    outRms > 10,
    `real audio is non-silent after opus round-trip (rms=${outRms.toFixed(0)})`,
  );

  // Write the production-quality artifact: the broadcast's opus track, as it
  // would reach Discord listeners, decoded back to WAV for local playback.
  decodeNutToWav(nut, TMP_DECODED_WAV);

  out("");
  out("artifacts (listen and verify it sounds like MK64):");
  out(`  raw emulator PCM       -> ${TMP_RAW_WAV}`);
  out(`  muxed broadcast (NUT)  -> ${nut}`);
  out(`  opus round-trip decode -> ${TMP_DECODED_WAV}`);
}

async function main(): Promise<void> {
  requireBinary("ffmpeg");
  requireBinary("ffprobe");

  const args = Bun.argv.slice(2);
  const romIdx = args.indexOf("--rom");
  const wantRom = romIdx !== -1;
  const romCandidate = wantRom ? args.at(romIdx + 1) : undefined;
  const romArg =
    romCandidate !== undefined && !romCandidate.startsWith("--")
      ? romCandidate
      : undefined;

  await runSynthetic();
  if (wantRom) await runRom(romArg);

  out(
    wantRom
      ? "\nPASS: audio e2e (synthetic integration + real-emulator end-to-end)"
      : "\nPASS: audio integration (synthetic only — re-run with --rom for the real e2e)",
  );
  process.exit(0);
}

await main();
