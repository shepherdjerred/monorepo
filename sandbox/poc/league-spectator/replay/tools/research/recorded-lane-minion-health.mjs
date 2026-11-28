import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import {
  foldRecordedLaneMinionHealth,
  laneMinionHealthGroup,
  readLaneMinionHealthPrefix,
} from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/replay-lane-minion-health.mjs";
import { recordedEntityReplication } from "./recorded-champion-replication.mjs";
import {
  currentTerrainClientArchiveSha256,
  currentTerrainPositionBuild,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";

function readLaneReplication(binary, rawReplay, laneProof, includeSnapshots) {
  if (
    laneProof.kind !== "exact-terrain-lane-minion-waypoint-evidence" ||
    laneProof.build !== currentTerrainPositionBuild ||
    laneProof.protocol !== terrainPositionProtocol ||
    laneProof.nativeReaderSha256 !== currentTerrainClientArchiveSha256
  )
    throw Error("Exact .8428 bound lane-minion proof required");
  return recordedEntityReplication(
    binary,
    rawReplay,
    laneProof,
    laneProof.instances.map(({ context }) => context),
    {
      allowCurrentBuild: true,
      includeSnapshots,
      accepts: (group, mask) =>
        group === laneMinionHealthGroup && (mask & 3) !== 0,
    },
  );
}

export function extractRecordedLaneMinionHealth(binary, rawReplay, laneProof) {
  const replication = readLaneReplication(binary, rawReplay, laneProof, false);
  return {
    kind: "scout-recorded-lane-minion-health",
    ...replication.identity,
    tracks: foldRecordedLaneMinionHealth(
      laneProof.instances,
      replication.read(),
    ),
  };
}

if (import.meta.main) {
  const [archive, replay, actors, output] = Bun.argv.slice(2);
  if (!archive || !replay || !actors || !output || Bun.argv.length !== 6)
    throw Error(
      "Usage: bun recorded-lane-minion-health.mjs <archived client> <replay> <lane evidence> <new prefix evidence>",
    );
  const [binary, rawReplay, laneProofJson] = await Promise.all([
    readFile(archive),
    readFile(replay),
    readFile(actors, "utf8"),
  ]);
  const { identity, read } = readLaneReplication(
    binary,
    rawReplay,
    JSON.parse(laneProofJson),
    true,
  );
  const groups = [];
  for (const { bytes, fieldMask, stream } of read()) {
    if (stream !== 1 && stream !== 2) continue;
    groups.push({
      fieldMask,
      ...readLaneMinionHealthPrefix(fieldMask, bytes),
      stream,
      bytes: bytes.toString("hex"),
    });
  }
  const evidence = JSON.stringify({
    build: identity.build,
    identity: identity.replaySha256,
    groups,
  });
  await writeFile(output, evidence, { flag: "wx" });
  console.log(createHash("sha256").update(evidence).digest("hex"));
}
