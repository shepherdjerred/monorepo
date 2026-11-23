import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { zstdDecompressSync } from "node:zlib";
import { replayTimedPacketEnvelopes } from "../../replay-packet-clock.mjs";
import { verifyReplayParticipantBindings } from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/replay-participant-bindings.mjs";
import {
  openReplay,
  replayPacketEnvelopes,
} from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/transport.mjs";
import { createWaypointReader } from "./native-terrain-waypoints.mjs";

function inflate(bytes, output) {
  return zstdDecompressSync(bytes, { maxOutputLength: output.length });
}

async function verify(client, replayPath) {
  const bytes = await readFile(replayPath);
  const replay = openReplay(Uint8Array.from(bytes).buffer);
  const read = createWaypointReader(client, replay);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const { verified } = verifyReplayParticipantBindings(replay, inflate);
  const actors = new Map(
    verified.map(({ context, footerRow }) => [
      context,
      { footerRow, records: 0, first: null, last: null, path: null },
    ]),
  );
  const cohorts = new Map();
  let opcode;
  for (const envelope of replayTimedPacketEnvelopes(
    replayPacketEnvelopes(replay, inflate),
  )) {
    if (envelope.blockOffset === 0) opcode = null;
    opcode = envelope.explicitOpcode ?? opcode;
    if (opcode !== 96 && opcode !== 1174) continue;
    const { timeSeconds, stream } = envelope;
    const { syncId, records } = read(opcode, envelope.payload);
    const key = stream + "/" + opcode;
    let cohort = cohorts.get(key);
    if (!cohort) {
      cohort = { stream, opcode, packets: 0, records: 0 };
      cohorts.set(key, cohort);
    }
    cohort.packets++;
    cohort.records += records.length;
    if (stream !== 1) continue;
    for (const { entityId, encodedWaypoints, speed, motion } of records) {
      const actor = actors.get(entityId);
      if (!actor) continue;
      actor.records++;
      actor.first ??= timeSeconds;
      actor.last = timeSeconds;
      if (!actor.path && encodedWaypoints.length > 1) {
        actor.path = {
          opcode,
          timeSeconds,
          syncId,
          speed: motion?.speed ?? speed,
          encodedWaypoints,
        };
      }
    }
  }
  if (![...cohorts.values()].some(({ stream }) => stream === 1))
    throw Error("No gameplay waypoint packets in exact-build replay");
  return {
    replaySha256: digest,
    build: replay.build,
    protocol: replay.protocol,
    cohorts: [...cohorts.values()],
    boundActors: [...actors.values()],
  };
}

const [clientPath, ...replayPaths] = process.argv.slice(2);
if (!clientPath || !replayPaths.length)
  throw Error(
    "Usage: bun verify-native-terrain-waypoints.mjs <macOS client> <replay> [replay ...]",
  );
const client = await readFile(clientPath);
const evidence = [];
for (const replayPath of replayPaths)
  evidence.push(await verify(client, replayPath));
console.log(JSON.stringify(evidence, null, 2));
