import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { zstdDecompressSync } from "node:zlib";
import { replayTimedPacketEnvelopes } from "../../replay-packet-clock.mjs";
import { verifyReplayParticipantBindings } from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/replay-participant-bindings.mjs";
import {
  openReplay,
  replayPacketEnvelopes,
} from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/transport.mjs";
import { createMoveSpeed309Reader } from "./native-terrain-move-speed.mjs";

const inflate = (bytes, output) =>
  zstdDecompressSync(bytes, { maxOutputLength: output.length });

async function verify(client, replayPath) {
  const bytes = await readFile(replayPath);
  const replay = openReplay(Uint8Array.from(bytes).buffer);
  const read = createMoveSpeed309Reader(client, replay);
  const { verified } = verifyReplayParticipantBindings(replay, inflate);
  const boundActors = new Map(
    verified.map(({ context, footerRow }) => [
      context,
      { footerRow, updates: 0, first: null, last: null },
    ]),
  );
  const actorIds = new Set(boundActors.keys());
  const cohorts = new Map();
  let opcode;
  let transportSequence = 0;
  for (const packet of replayTimedPacketEnvelopes(
    replayPacketEnvelopes(replay, inflate),
  )) {
    transportSequence++;
    if (packet.blockOffset === 0) opcode = null;
    opcode = packet.explicitOpcode ?? opcode;
    if (opcode !== 309) continue;
    const { stream, timeSeconds } = packet;
    let cohort = cohorts.get(stream);
    if (!cohort) {
      cohort = {
        stream,
        packets: 0,
        records: 0,
        championGroups: 0,
        updates: 0,
      };
      cohorts.set(stream, cohort);
    }
    const { recordCount, championGroups, updates } = read(
      packet.payload,
      actorIds,
    );
    cohort.packets++;
    cohort.records += recordCount;
    cohort.championGroups += championGroups;
    cohort.updates += updates.length;
    for (const { entityId, recordIndex, moveSpeed } of updates) {
      const actor = boundActors.get(entityId);
      const row = {
        timeSeconds,
        stream,
        transportSequence,
        recordIndex,
        moveSpeed,
      };
      actor.updates++;
      actor.first ??= row;
      actor.last = row;
    }
  }
  if (!cohorts.has(1))
    throw Error("No gameplay opcode 309 replication packets");
  return {
    replaySha256: createHash("sha256").update(bytes).digest("hex"),
    build: replay.build,
    protocol: replay.protocol,
    cohorts: [...cohorts.values()],
    boundActors: [...boundActors.values()],
  };
}

const [clientPath, ...replayPaths] = process.argv.slice(2);
if (!clientPath || !replayPaths.length)
  throw Error(
    "Usage: bun verify-native-terrain-move-speed.mjs <macOS client> <replay> [replay ...]",
  );
const client = await readFile(clientPath);
const evidence = [];
for (const replayPath of replayPaths)
  evidence.push(await verify(client, replayPath));
console.log(JSON.stringify(evidence, null, 2));
