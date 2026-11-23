import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, relative, resolve, sep } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { createReplayPacketReader } from "../../../../../packages/scout-for-lol/packages/replay/src/observations/packet-reader.mjs";
import {
  exactAnnouncerSource,
  heraldAudioSource,
  infernalTransitionSource,
  readExactHeraldAudio,
  readExactInfernalTransition,
  readExactTerrainAnnouncerCandidates,
  scheduleAnnouncerWindow,
} from "./research/exact-terrain-announcer.mjs";

const [
  replayPath,
  packPath,
  decoderPath,
  outputPath,
  infernalPackPath,
  heraldBankPath,
] = process.argv.slice(2);
assert.ok(
  replayPath && packPath && decoderPath && outputPath,
  "Usage: bun verify-exact-terrain-announcer.mjs <saved ROFL> <Female1 English WPK> <vgmstream-cli> <new .cache directory> [Infernal transition WPK [Rift Herald audio BNK]]",
);
const output = resolve(outputPath);
const cachePath = relative(resolve(".cache"), output);
assert.ok(
  cachePath &&
    cachePath.split(sep)[0] !== ".." &&
    resolve(".cache", cachePath) === output,
);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const replay = await Bun.file(replayPath).arrayBuffer();
const replaySha256 = sha256(Buffer.from(replay));
const reader = createReplayPacketReader(replay, (input, target) =>
  zstdDecompressSync(input, { maxOutputLength: target.byteLength }),
);
const cues = readExactTerrainAnnouncerCandidates(reader, replaySha256);
const pack = await readFile(packPath);
assert.equal(sha256(pack), exactAnnouncerSource.packSha256);
const sources = cues.map((cue) => ({
  cue,
  pack,
  channels: exactAnnouncerSource.channels,
}));
if (infernalPackPath) {
  const infernalPack = await readFile(infernalPackPath);
  assert.equal(sha256(infernalPack), infernalTransitionSource.packSha256);
  sources.push({
    cue: readExactInfernalTransition(reader, replaySha256),
    pack: infernalPack,
    channels: exactAnnouncerSource.channels,
  });
}

function packedMedia(pack, mediaId) {
  assert.equal(pack.toString("ascii", 0, 4), "r3d2");
  assert.equal(pack.readUInt32LE(4), 1);
  let wem = null;
  for (let index = 0; index < pack.readUInt32LE(8); index++) {
    const record = pack.readUInt32LE(12 + index * 4);
    const nameStart = record + 12;
    const nameEnd = nameStart + 2 * pack.readUInt32LE(record + 8);
    if (pack.toString("utf16le", nameStart, nameEnd) !== `${mediaId}.wem`)
      continue;
    assert.equal(wem, null, "Duplicate WPK media");
    const offset = pack.readUInt32LE(record);
    wem = pack.subarray(offset, offset + pack.readUInt32LE(record + 4));
  }
  assert.ok(wem, "Missing WPK media");
  return wem;
}

function embeddedMedia(bank, mediaId) {
  assert.equal(bank.toString("ascii", 0, 4), "BKHD");
  const chunks = new Map();
  for (let offset = 0; offset < bank.length;) {
    const start = offset + 8;
    const end = start + bank.readUInt32LE(offset + 4);
    const tag = bank.toString("ascii", offset, offset + 4);
    assert.ok(end <= bank.length && !chunks.has(tag));
    chunks.set(tag, bank.subarray(start, end));
    offset = end;
  }
  const index = chunks.get("DIDX");
  const data = chunks.get("DATA");
  assert.ok(index && data && index.length % 12 === 0);
  let wem;
  for (let offset = 0; offset < index.length; offset += 12) {
    if (index.readUInt32LE(offset) !== mediaId) continue;
    const start = index.readUInt32LE(offset + 4);
    const end = start + index.readUInt32LE(offset + 8);
    assert.ok(!wem && end <= data.length);
    wem = data.subarray(start, end);
  }
  assert.ok(wem, "Missing BNK media");
  return wem;
}

if (heraldBankPath) {
  const bank = await readFile(heraldBankPath);
  assert.equal(sha256(bank), heraldAudioSource.bankSha256);
  sources.push({
    cue: readExactHeraldAudio(reader, replaySha256),
    bank,
    channels: heraldAudioSource.channels,
  });
}

await mkdir(output);
const { sampleRate } = exactAnnouncerSource;
const media = [];
for (const { cue, pack, bank, channels } of sources) {
  const wem = bank
    ? embeddedMedia(bank, cue.mediaId)
    : packedMedia(pack, cue.mediaId);
  assert.equal(sha256(wem), cue.wemSha256);
  const wemPath = join(output, `${cue.mediaId}.wem`);
  const decodedPath = join(output, `${cue.mediaId}.wav`);
  await writeFile(wemPath, wem);
  const decode = Bun.spawnSync([
    resolve(decoderPath),
    "-o",
    decodedPath,
    wemPath,
  ]);
  assert.equal(decode.exitCode, 0, decode.stderr.toString());
  const wav = await readFile(decodedPath);
  media.push({
    cue,
    channels,
    wavSha256: sha256(wav),
    wav: wav.toString("base64"),
  });
}

const require = createRequire(
  new URL(
    "../../../../../packages/scout-for-lol/packages/app/package.json",
    import.meta.url,
  ),
);
const { chromium } = require("@playwright/test");
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--mute-audio"],
});
try {
  const page = await browser.newPage();
  const results = [];
  for (const { cue, channels, wavSha256, wav } of media) {
    const time = cue.timeSeconds;
    const fullWindow = Math.max(5, Math.ceil(cue.frames / sampleRate) + 1);
    const renderLength = fullWindow * sampleRate;
    const windows = {
      reference: scheduleAnnouncerWindow(cue, time, time + fullWindow, 1),
      sequential: scheduleAnnouncerWindow(
        cue,
        time - 1,
        time + fullWindow - 1,
        1,
      ),
      fast: scheduleAnnouncerWindow(cue, time - 1, time + 9, 2),
      fastReference: scheduleAnnouncerWindow(cue, time, time + 10, 2),
      seek: scheduleAnnouncerWindow(
        cue,
        time + 0.5,
        time + fullWindow + 0.5,
        1,
      ),
      after: scheduleAnnouncerWindow(
        cue,
        time + fullWindow - 1,
        time + fullWindow * 2 - 1,
        1,
      ),
      rewind: scheduleAnnouncerWindow(cue, time - 1, time + fullWindow - 1, 1),
    };
    const proof = await page.evaluate(
      async ({ wav, windows, channels, sampleRate, renderLength }) => {
        const decode = new OfflineAudioContext(channels, 1, sampleRate);
        const bytes = Uint8Array.from(atob(wav), (character) =>
          character.charCodeAt(0),
        );
        const sourceBuffer = await decode.decodeAudioData(bytes.buffer);
        async function render(window) {
          const context = new OfflineAudioContext(
            channels,
            renderLength,
            sampleRate,
          );
          if (window !== null) {
            const source = context.createBufferSource();
            source.buffer = sourceBuffer;
            source.playbackRate.value = window.rate;
            source.connect(context.destination);
            source.start(
              window.startSeconds,
              window.sourceOffsetSeconds,
              window.sourceDurationSeconds,
            );
          }
          return (await context.startRendering()).getChannelData(0);
        }
        const reference = await render(windows.reference);
        const sequential = await render(windows.sequential);
        const fast = await render(windows.fast);
        const fastReference = await render(windows.fastReference);
        const seek = await render(windows.seek);
        const after = await render(windows.after);
        const rewind = await render(windows.rewind);
        const onset = (pcm) =>
          pcm.findIndex((sample) => Math.abs(sample) > 1 / 32768);
        return {
          channels: sourceBuffer.numberOfChannels,
          frames: sourceBuffer.length,
          sourceOnset: onset(reference),
          sequentialOnset: onset(sequential),
          fastOnset: onset(fast),
          fastReferenceOnset: onset(fastReference),
          seekMatches: seek
            .subarray(0, sourceBuffer.length - sampleRate / 2)
            .every(
              (sample, frame) => sample === reference[frame + sampleRate / 2],
            ),
          afterIsSilent: after.every((sample) => sample === 0),
          rewindMatches: rewind.every(
            (sample, frame) => sample === sequential[frame],
          ),
        };
      },
      { wav, windows, channels, sampleRate, renderLength },
    );
    assert.equal(proof.channels, channels);
    assert.equal(proof.frames, cue.frames);
    assert.ok(proof.sourceOnset >= 0 && proof.fastReferenceOnset >= 0);
    assert.equal(proof.sequentialOnset - proof.sourceOnset, sampleRate);
    assert.ok(
      Math.abs(proof.fastOnset - proof.fastReferenceOnset - sampleRate / 2) <=
        1,
    );
    assert.ok(proof.seekMatches && proof.afterIsSilent && proof.rewindMatches);
    results.push({ cue, wavSha256, windows, proof });
  }
  await writeFile(
    join(output, "receipt.json"),
    JSON.stringify(
      {
        scope:
          "Offline replay clock with explicitly selected Map11 Female1 English assets",
        nativeSpectatorAudioAdmissionVerified: false,
        replaySha256,
        build: reader.build,
        protocol: reader.protocol,
        ...exactAnnouncerSource,
        ...(infernalPackPath && {
          infernalPackSha256: infernalTransitionSource.packSha256,
        }),
        ...(heraldBankPath && {
          heraldBankSha256: heraldAudioSource.bankSha256,
        }),
        browser: browser.version(),
        results,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
}
