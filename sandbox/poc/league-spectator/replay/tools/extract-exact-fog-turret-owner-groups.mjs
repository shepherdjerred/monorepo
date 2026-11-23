import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { recordedEntityReplication } from "./research/recorded-champion-replication.mjs";

const [replay, binary, ownerCensus, output] = process.argv.slice(2);
if (process.argv.length !== 6)
  throw Error(
    "Usage: bun extract-exact-fog-turret-owner-groups.mjs <saved-rofl> <exact-macos-binary> <owner-census> <new-output.json>",
  );

const censusBytes = readFileSync(ownerCensus);
const censusSha256 = createHash("sha256").update(censusBytes).digest("hex");
assert.equal(
  censusSha256,
  "b1f38dc0f852055d5a2d38aa34afca08a7dacd207b07a082601588fe7a3b41bc",
);
const census = JSON.parse(censusBytes);
const turretIds = census.rows
  .filter(({ worldBinding }) => worldBinding?.family === "structureModels")
  .map(({ ownerId }) => ownerId);
assert.equal(turretIds.length, 11);
const reader = recordedEntityReplication(
  readFileSync(binary),
  readFileSync(replay),
  census,
  turretIds,
  { includeSnapshots: true, accepts: (group) => group === 32 },
);
const groups = Array.from(reader.read())
  .filter(({ timeSeconds }) => timeSeconds <= census.keyframe.timeSeconds)
  .map(({ bytes, participantId, ...row }) => ({
    ...row,
    ownerId: participantId,
    dataHex: bytes.toString("hex"),
  }));
assert.equal(groups.length, 22);
for (const ownerId of turretIds) {
  const selection = groups.filter((row) => row.ownerId === ownerId);
  assert.deepEqual(
    selection.map(({ stream, timeSeconds, fieldMask }) => [
      stream,
      timeSeconds,
      fieldMask,
    ]),
    [
      [1, 0, 0xffff],
      [2, census.keyframe.timeSeconds, 0xffff],
    ],
  );
}
const report = { ...reader.identity, censusSha256, groups };
writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
