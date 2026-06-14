// Manual e2e for the Go-Live audio path. Proves that PCM written to the audio
// transport is actually muxed into prepareStream's broadcast output as a
// non-silent opus track — the exact pipeline GameStreamer uses, minus Discord.
//
// Two modes:
//   - synthetic (default): feeds a generated sine tone. Needs only ffmpeg/ffprobe
//     (no ROM, no wasm), so it runs anywhere and exercises the transport + the
//     real prepareStream + the in-repo discord-video-stream end to end.
//   - --rom [path]: additionally boots the REAL emulator, drains its audio via
//     onAudio for a few seconds, asserts the game produced non-silent sound, and
//     pushes that real PCM through the same pipeline. Requires the built wasm core
//     (bun run build:wasm) and the MK64 ROM.
//
// Usage:
//   bun run e2e:audio                 # synthetic only
//   bun run e2e:audio --rom           # synthetic + real emulator (ROM auto-resolved)
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

const TMP_NUT = "/tmp/mk64-audio-e2e.nut";

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
      `rom mode needs the built wasm core at ${wasm} (run: bun run build:wasm)`,
    );
  }

  const emu = await bootEmulator({ rom, seats: 1 });
  const chunks: Buffer[] = [];
  emu.onAudio((pcm) => chunks.push(pcm));

  // Let the attract demo / boot run a few hundred frames so the title/intro audio
  // is generated, then stop and inspect what was drained.
  await new Promise<void>((resolve) => {
    let frame = 0;
    emu.onFrame(() => {
      frame++;
      if (frame >= 600) {
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

  out("\nPASS: audio e2e");
  process.exit(0);
}

await main();
