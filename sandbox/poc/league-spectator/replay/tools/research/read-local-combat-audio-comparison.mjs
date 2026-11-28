import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const creationSha256 =
  "a81ef3bd9669e5f04966c03d50518bd6a184bdbd2892753f7d4508334266c104";
const wavSha256 =
  "02e373efb53b3f063203c1398b358ff064334e48191ed910673d7e36d73c0300";
const digest = (bytes) => Bun.CryptoHasher.hash("sha256", bytes, "hex");

export async function readLocalCombatAudioComparison(inputPath, identity) {
  const { creationReceipt, wav } = JSON.parse(
    await readFile(inputPath, "utf8"),
  );
  const [creationBytes, audio] = await Promise.all([
    readFile(creationReceipt),
    readFile(wav),
  ]);
  assert.equal(
    digest(creationBytes),
    creationSha256,
    "Wrong original creation receipt",
  );
  assert.equal(digest(audio), wavSha256, "Wrong verbatim decoded cue");
  const creation = JSON.parse(creationBytes);
  for (const field of ["build", "protocol", "replaySha256"])
    assert.equal(creation[field], identity[field]);
  assert.equal(identity.build, "16.23.841.8428");
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
  const [event] = matching;
  assert.ok(
    event.stamp > 0 && event.stamp < identity.durationMilliseconds / 1000,
  );
  const timeline = {
    replaySha256: identity.replaySha256,
    scope: "packet-clock-dry-source",
    timeSeconds: event.stamp,
    mediaId: 329446178,
  };
  return new Map([
    ["combat-audio/cue.json", Buffer.from(JSON.stringify(timeline))],
    ["combat-audio/329446178.wav", audio],
  ]);
}
