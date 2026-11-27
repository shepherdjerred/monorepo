import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  currentAnnouncerSource,
  exactAnnouncerSource,
  heraldAudioSource,
  infernalTransitionSource,
  readCurrentAnnouncerCandidates,
  readExactHeraldAudio,
  readExactInfernalTransition,
  readExactTerrainAnnouncerCandidates,
} from "./research/exact-terrain-announcer.mjs";

const receiptDigests = new Map([
  [
    "d7cabb0b7ba965f317863d128238847a0b9b0e4cc0cdbcfa3077c537b10fdf2b",
    "79f19864ad704076453e24b3cc9bad4b7c14b43530414c1d7ba508269fe1198b",
  ],
  [
    "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668",
    "7459c1185ca9a1c6b8a939b2c938796095ed2acdcf46655efe06b2a4b22f884f",
  ],
]);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const infernalReceiptSha256 =
  "f52db6acd31f7887e2a405292d62f9dbb346808334b44463b3e7e0a7852334b7";
const objectiveReceiptSha256 =
  "0060f8a929873f55e30f5d303222ea042799f2d7b136e3b7ec046110d4341aed";
const currentReceiptSha256 =
  "33ec8c642051dfcc110824dd82313b29e1c7e1778e378c34b7df91f50bed559d";

export async function readLocalAnnouncerPreview(
  directory,
  packetReader,
  identity,
) {
  const receipt = await readFile(join(directory, "receipt.json"));
  const receiptSha256 = sha256(receipt);
  const isCurrent =
    identity.replaySha256 === currentAnnouncerSource.replaySha256 &&
    identity.build === currentAnnouncerSource.build;
  const isLong =
    identity.replaySha256 === infernalTransitionSource.replaySha256;
  const includesHerald = isLong && receiptSha256 === objectiveReceiptSha256;
  const includesInfernal =
    includesHerald || (isLong && receiptSha256 === infernalReceiptSha256);
  assert.ok(
    includesInfernal ||
      (isCurrent && receiptSha256 === currentReceiptSha256) ||
      receiptSha256 === receiptDigests.get(identity.replaySha256),
    "Announcer receipt must match the reviewed copy for this ROFL",
  );
  const evidence = JSON.parse(receipt.toString("utf8"));
  const cues = isCurrent
    ? readCurrentAnnouncerCandidates(packetReader, identity.replaySha256)
    : readExactTerrainAnnouncerCandidates(packetReader, identity.replaySha256);
  if (isCurrent) {
    assert.equal(evidence.replaySha256, identity.replaySha256);
    assert.equal(evidence.build, identity.build);
    assert.equal(evidence.protocol, identity.protocol);
    assert.deepEqual(evidence.authored, {
      mapSha256: currentAnnouncerSource.mapSha256,
      globalSha256: currentAnnouncerSource.globalSha256,
    });
    assert.equal(
      evidence.elementalPackSha256,
      infernalTransitionSource.packSha256,
    );
    assert.equal(evidence.heraldBankSha256, heraldAudioSource.bankSha256);
  }
  if (includesInfernal) {
    assert.equal(
      evidence.infernalPackSha256,
      infernalTransitionSource.packSha256,
    );
    cues.push(readExactInfernalTransition(packetReader, identity.replaySha256));
  }
  if (includesHerald) {
    assert.equal(evidence.heraldBankSha256, heraldAudioSource.bankSha256);
    cues.push(readExactHeraldAudio(packetReader, identity.replaySha256));
  }
  assert.deepEqual(
    evidence.results.map(({ cue }) => cue),
    cues,
  );
  assert.equal(evidence.packSha256, exactAnnouncerSource.packSha256);
  const files = new Map();
  for (const { cue, wavSha256 } of evidence.results) {
    const filename = `${cue.mediaId}.wav`;
    const wav = await readFile(join(directory, filename));
    assert.equal(
      sha256(wav),
      wavSha256,
      `Unverified announcer export: ${filename}`,
    );
    files.set(`announcer-preview/${filename}`, wav);
  }
  files.set(
    "announcer-preview/cues.json",
    Buffer.from(
      JSON.stringify({
        profile: "female1-en-us",
        replaySha256: identity.replaySha256,
        receiptSha256,
        cues: cues.map(({ mediaId, timeSeconds }) => ({
          mediaId,
          timeSeconds,
        })),
      }),
    ),
  );
  return files;
}
