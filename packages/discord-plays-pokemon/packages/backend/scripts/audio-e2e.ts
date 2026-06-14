// End-to-end audio harness for the m4a TS port. Boots the real
// pokeemerald.wasm via `Emulator`, runs N frames while capturing the PCM
// emitted by the m4a engine's per-frame drain, writes the captured PCM as a
// WAV file, runs that WAV through the exact ffmpeg Opus pipeline
// `prepareStream` uses (libopus, 48 kHz stereo, NUT container), decodes the
// Opus back to a round-trip WAV, then offers to `afplay` both so a human can
// hear the result.
//
// Usage:
//   bun run scripts/audio-e2e.ts                # default: ~5s capture + afplay
//   bun run scripts/audio-e2e.ts --frames 600   # custom capture length
//   bun run scripts/audio-e2e.ts --no-play      # skip afplay
//   bun run scripts/audio-e2e.ts --update-baseline
//                                                # overwrite the fingerprint
//                                                # fixture from this run
//
// Outputs land in `scripts/out/`:
//   - audio-e2e-source.wav      (Float32 stereo at native ~13379 Hz —
//                                the un-quantised mixer output, ~40 dB
//                                cleaner than the s8 pcmBuffer)
//   - audio-e2e-opus.opus       (Opus packet stream)
//   - audio-e2e-roundtrip.wav   (Opus decoded back to s16 for listening)

import { Emulator } from "#src/emulator/emulator.ts";
import type { DrainResult } from "#src/emulator/audio/m4a-driver.ts";
import { encodeWav } from "#src/emulator/audio/wav.ts";
import { logger } from "#src/logger.ts";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}
function argFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

const CAPTURE_FRAMES = Number(argValue("--frames") ?? "300"); // ~5s at 60 fps
const SHOULD_PLAY = !argFlag("--no-play");
const UPDATE_BASELINE = argFlag("--update-baseline");
const OUT_DIR = new URL("out/", import.meta.url).pathname;
const FIXTURE_DIR = new URL("../src/__tests__/fixtures/", import.meta.url)
  .pathname;
const WASM_PATH = new URL("../assets/pokeemerald.wasm", import.meta.url)
  .pathname;

logger.info(`booting ${WASM_PATH}`);
const emulator = new Emulator({ wasmPath: WASM_PATH });
await emulator.init();
// ottohg's wasm boots its own m4a engine during AgbMain; no host-side init
// call is needed. PCM starts flowing as soon as the title-screen track
// loader runs (typically within the first few seconds of game time).

const collected: DrainResult[] = [];
let nativeRate = 0;
emulator.onAudio((pcm) => {
  collected.push(pcm);
  if (nativeRate === 0) nativeRate = pcm.freqHz;
});

logger.info(`advancing ${String(CAPTURE_FRAMES)} frames`);
emulator.start();
await new Promise<void>((resolve) => {
  const tick = (): void => {
    if (emulator.frame >= CAPTURE_FRAMES) {
      emulator.stop();
      resolve();
      return;
    }
    setTimeout(tick, 50);
  };
  tick();
});

if (collected.length === 0) {
  logger.error(
    "no PCM was drained — onAudio never fired. gSoundInfo.pcmFreq is " +
      "likely still 0; initAudio() should have set it. Investigate.",
  );
  process.exit(1);
}

const totalBytes = collected.reduce((acc, r) => acc + r.pcm.length, 0);
// Float32 stereo = 8 bytes per stereo frame; divide once more to get seconds.
logger.info(
  `captured ${String(collected.length)} frames of PCM @ ${String(nativeRate)} Hz` +
    ` (${String(totalBytes)} bytes total, ${(totalBytes / nativeRate / 8).toFixed(2)}s)`,
);

const sourcePcm = Buffer.concat(collected.map((r) => r.pcm));
const sourceWav = encodeWav(sourcePcm, {
  sampleRate: nativeRate,
  channels: 2,
  bitsPerSample: 32,
  format: "float",
});
const sourceWavPath = `${OUT_DIR}audio-e2e-source.wav`;
await Bun.write(sourceWavPath, sourceWav);
logger.info(`wrote ${sourceWavPath}`);

// Sanity-check the source: RMS of the interleaved Float32 stream. A typical
// game audio signal lands ~0.05–0.20 RMS; below ~0.005 means the engine is
// producing silence and Opus encode won't change that.
let rmsAcc = 0;
const frames = sourcePcm.length / 8;
for (let i = 0; i < frames; i++) {
  const l = sourcePcm.readFloatLE(i * 8);
  const r = sourcePcm.readFloatLE(i * 8 + 4);
  rmsAcc += l * l + r * r;
}
const sourceRms = Math.sqrt(rmsAcc / (frames * 2));
logger.info(`source PCM RMS: ${sourceRms.toFixed(4)} (Float32, ±1.0)`);
if (sourceRms < 0.005) {
  logger.warn(
    "source PCM is effectively silent — engine handlers likely need polish.",
  );
}

// ---- ffmpeg: source WAV → Opus (matches prepareStream's audio config) ----
const opusPath = `${OUT_DIR}audio-e2e-opus.opus`;
const opusEncode = Bun.spawnSync({
  cmd: [
    "ffmpeg",
    "-y",
    "-loglevel",
    "error",
    "-i",
    sourceWavPath,
    "-ac",
    "2",
    "-ar",
    "48000",
    "-c:a",
    "libopus",
    "-b:a",
    "96k",
    "-application",
    "audio",
    "-f",
    "opus",
    opusPath,
  ],
  stdio: ["ignore", "inherit", "inherit"],
});
if (opusEncode.exitCode !== 0) {
  logger.error("ffmpeg Opus encode failed");
  process.exit(1);
}

// ---- ffmpeg: Opus → round-trip WAV (for listening + analysis) -----------
const roundtripPath = `${OUT_DIR}audio-e2e-roundtrip.wav`;
const opusDecode = Bun.spawnSync({
  cmd: [
    "ffmpeg",
    "-y",
    "-loglevel",
    "error",
    "-i",
    opusPath,
    "-ac",
    "2",
    "-ar",
    "48000",
    roundtripPath,
  ],
  stdio: ["ignore", "inherit", "inherit"],
});
if (opusDecode.exitCode !== 0) {
  logger.error("ffmpeg Opus decode failed");
  process.exit(1);
}

logger.info(`wrote ${opusPath}`);
logger.info(`wrote ${roundtripPath}`);

if (UPDATE_BASELINE) {
  // Trim the leading silence (the wasm boots its m4a engine partway through
  // AgbMain; the first ~2s is pure intro before BGM starts) so the baseline
  // is a clean musical signal, not "two seconds of zeros, then music."
  // Float32 ±1.0 peak threshold: 0.03 = ~-30 dBFS, well below any real music
  // but well above the all-zero pre-init state.
  const SILENCE_THRESHOLD_F32 = 0.03;
  const samplesPerFrame = collected[0]?.frames ?? nativeRate / 60;
  const firstNoisyFrame = collected.findIndex((r) => {
    let peak = 0;
    const fr = r.pcm.length / 8;
    for (let i = 0; i < fr; i++) {
      const l = Math.abs(r.pcm.readFloatLE(i * 8));
      const rr = Math.abs(r.pcm.readFloatLE(i * 8 + 4));
      if (l > peak) peak = l;
      if (rr > peak) peak = rr;
    }
    return peak > SILENCE_THRESHOLD_F32;
  });
  const startFrame = firstNoisyFrame === -1 ? 0 : firstNoisyFrame;
  const trimmedFrames = collected.slice(startFrame);
  const trimmedPcm = Buffer.concat(trimmedFrames.map((r) => r.pcm));
  const trimmedWav = encodeWav(trimmedPcm, {
    sampleRate: nativeRate,
    channels: 2,
    bitsPerSample: 32,
    format: "float",
  });
  const baselinePath = `${FIXTURE_DIR}title-bgm-baseline.wav`;
  await Bun.write(baselinePath, trimmedWav);
  logger.info(
    `updated baseline at ${baselinePath} (skipped ${String(startFrame)} silent` +
      ` frames = ${(startFrame * (samplesPerFrame / nativeRate)).toFixed(2)}s)`,
  );
}

if (SHOULD_PLAY) {
  logger.info("playing source WAV (engine output, native rate):");
  Bun.spawnSync({
    cmd: ["afplay", sourceWavPath],
    stdio: ["ignore", "inherit", "inherit"],
  });
  logger.info("playing round-trip WAV (after Opus encode + decode):");
  Bun.spawnSync({
    cmd: ["afplay", roundtripPath],
    stdio: ["ignore", "inherit", "inherit"],
  });
}

logger.info("done.");
process.exit(0);
