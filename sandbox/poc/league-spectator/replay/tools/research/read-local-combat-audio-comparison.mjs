import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const creationSha256 =
  "a81ef3bd9669e5f04966c03d50518bd6a184bdbd2892753f7d4508334266c104";
const wholeReplayCreationSha256 =
  "d52f4b00406296913173dc8b487efc5c549ac59f60f6189d1bb3db7125e4708d";
const wavSha256 =
  "02e373efb53b3f063203c1398b358ff064334e48191ed910673d7e36d73c0300";
const digest = (bytes) => Bun.CryptoHasher.hash("sha256", bytes, "hex");

export async function readReviewedCombatAudioWav(path) {
  const audio = await readFile(path);
  assert.equal(digest(audio), wavSha256, "Wrong verbatim decoded cue");
  return audio;
}

function readComparisonClock(creationBytes, identity) {
  const receiptDigest = digest(creationBytes);
  const wholeReplay = receiptDigest === wholeReplayCreationSha256;
  assert.ok(
    wholeReplay || receiptDigest === creationSha256,
    "Wrong original creation receipt",
  );
  const creation = JSON.parse(creationBytes);
  for (const field of ["build", "protocol", "replaySha256"])
    assert.equal(creation[field], identity[field]);
  assert.equal(identity.build, "16.23.841.8428");

  if (wholeReplay) {
    const times = creation.events.map(({ stamp }) => stamp);
    assert.ok(
      times.every(
        (stamp, index) =>
          stamp > (times[index - 1] ?? 0) &&
          stamp < identity.durationMilliseconds / 1000,
      ),
      "Combat comparison timeline differs from the replay clock",
    );
    return { timesSeconds: times };
  }
  const matching = creation.events.filter(
    ({ handle, owner, resourceKey, packetSha256, status }) =>
      handle === 1073821562 &&
      owner === 1073742165 &&
      resourceKey === 1806729623 &&
      packetSha256 ===
        "70e9f513e0af3a2dbe8c1c42094ed92406acaf8ca7a43c268b7f047ec5537287" &&
      status === "detached-placement-confirmed",
  );
  assert.equal(matching.length, 1);
  const [{ stamp }] = matching;
  assert.ok(stamp > 0 && stamp < identity.durationMilliseconds / 1000);
  return { timeSeconds: stamp };
}

export async function readLocalCombatAudioComparison(inputPath, identity) {
  const { creationReceipt, wav } = JSON.parse(
    await readFile(inputPath, "utf8"),
  );
  const [creationBytes, audio] = await Promise.all([
    readFile(creationReceipt),
    readReviewedCombatAudioWav(wav),
  ]);
  const timeline = {
    replaySha256: identity.replaySha256,
    scope: "packet-clock-dry-source",
    ...readComparisonClock(creationBytes, identity),
    mediaId: 329446178,
  };
  return new Map([
    ["combat-audio/cue.json", Buffer.from(JSON.stringify(timeline))],
    ["combat-audio/329446178.wav", audio],
  ]);
}
