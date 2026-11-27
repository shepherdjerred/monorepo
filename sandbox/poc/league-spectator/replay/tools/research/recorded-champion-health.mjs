import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { recordedChampionReplication } from "./recorded-champion-replication.mjs";

function readHealthFields(fieldMask, bytes) {
  let cursor = 0;
  const values = {};
  for (const [index, field] of ["current", "max"].entries()) {
    if ((fieldMask & (1 << index)) === 0) continue;
    if (bytes[cursor] === 0xff) {
      cursor += 1;
      values[field] = 0;
    } else {
      if (bytes[cursor] === 0xfe) cursor += 1;
      if (cursor + 4 > bytes.length)
        throw Error("Truncated champion health field");
      values[field] = bytes.readFloatLE(cursor);
      cursor += 4;
    }
    if (!Number.isFinite(values[field]) || values[field] < 0) {
      throw Error(`Invalid recorded ${field} health`);
    }
  }
  return { values, prefixBytes: cursor };
}

function appendPoint(points, time, { current, max }) {
  if (current === undefined || max === undefined || max === 0) {
    if (points.length === 0) return;
    throw Error("Recorded health lost its valid maximum");
  }
  const last = points.at(-1);
  if (last?.[0] === time) {
    last[1] = current;
    last[2] = max;
  } else if (last?.[1] !== current || last?.[2] !== max) {
    points.push([time, current, max]);
  }
}

export function extractRecordedChampionHealth(
  binary,
  rawReplay,
  scene,
  onGroup,
) {
  const replication = recordedChampionReplication(binary, rawReplay, scene, {
    allowCurrentBuild: true,
    accepts: (group, fieldMask) => group === 32 && (fieldMask & 3) !== 0,
    includeSnapshots: onGroup !== undefined,
  });
  const participants = new Map(
    [...replication.participants].map((participantId) => [
      participantId,
      { values: {}, points: [] },
    ]),
  );
  for (const {
    participantId,
    fieldMask,
    bytes,
    stream,
    timeSeconds,
  } of replication.read()) {
    const { values, prefixBytes } = readHealthFields(fieldMask, bytes);
    onGroup?.({
      participantId,
      fieldMask,
      prefixBytes,
      values,
      stream,
      bytes: bytes.toString("hex"),
    });
    // Keyframes are seek snapshots. Folding them into chronological event
    // playback would overwrite state at an unrelated clock boundary.
    if (stream !== 1) continue;
    const state = participants.get(participantId);
    Object.assign(state.values, values);
    appendPoint(state.points, timeSeconds, state.values);
  }
  const tracks = [...participants].map(([participantId, { points }]) => {
    if (points.length === 0)
      throw Error(`Recorded health missing for participant ${participantId}`);
    return { participantId, points };
  });
  return {
    kind: "scout-recorded-champion-health",
    ...replication.identity,
    tracks,
  };
}

if (import.meta.main) {
  const [archive, replay, scene, output, oracleInput] = process.argv.slice(2);
  if (!archive || !replay || !scene || !output) {
    throw Error(
      "Usage: bun recorded-champion-health.mjs <archive> <replay> <bound-scene.json> <output.json> [oracle-groups.json]",
    );
  }
  const groups = [];
  const artifact = extractRecordedChampionHealth(
    readFileSync(archive),
    readFileSync(replay),
    JSON.parse(readFileSync(scene, "utf8")),
    oracleInput === undefined ? undefined : (group) => groups.push(group),
  );
  const bytes = JSON.stringify(artifact) + "\n";
  writeFileSync(output, bytes, { flag: "wx" });
  if (oracleInput !== undefined) {
    writeFileSync(
      oracleInput,
      JSON.stringify({
        identity: artifact.replaySha256,
        build: artifact.build,
        groups,
      }),
      { flag: "wx" },
    );
  }
  console.log(
    JSON.stringify({
      sha256: createHash("sha256").update(bytes).digest("hex"),
      tracks: artifact.tracks.map(({ participantId, points }) => [
        participantId,
        points.length,
      ]),
    }),
  );
}
