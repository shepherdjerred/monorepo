import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { realpath, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { zstdDecompressSync } from "node:zlib";
import { replayTimedPacketEnvelopes } from "../../replay-packet-clock.mjs";
import { openReplay, replayPacketEnvelopes } from "../../transport.mjs";
import { verifyCanonicalRecordedRift } from "./verify-canonical-rift-replay.mjs";

const [rofl, match, matchSha, executable, output, python, ...pythonArgs] =
  process.argv.slice(2);
assert(
  python,
  "Usage: bun discover-recorded-maokai-launches.mjs <rofl> <match-v5> <match-sha256> <archived-executable> <private-output> <python-command> [args...]",
);
const cache = await realpath(".cache");
const parent = await realpath(dirname(resolve(output)));
assert(parent === cache || parent.startsWith(cache + sep));
assert(!(await Bun.file(output).exists()), "Expected fresh private output");

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bytes = await Bun.file(rofl).arrayBuffer();
const replay = openReplay(bytes);
await verifyCanonicalRecordedRift(match, matchSha, rofl, replay);

function* packets() {
  let opcode;
  let context;
  let sequence = 0;
  const inflate = (input, buffer) =>
    zstdDecompressSync(input, { maxOutputLength: buffer.length });
  for (const packet of replayTimedPacketEnvelopes(
    replayPacketEnvelopes(replay, inflate),
  )) {
    sequence += 1;
    if (packet.blockOffset === 0) {
      opcode = null;
      context = 0;
    }
    opcode = packet.explicitOpcode ?? opcode;
    context =
      packet.marker & 32
        ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
        : packet.paramBits;
    if (packet.stream === 1) yield { packet, sequence, opcode, context };
  }
}

const creation = [];
const launchBySequence = [];
for (const record of packets()) {
  if (record.opcode !== 639) continue;
  creation.push([
    record.context,
    Buffer.from(record.packet.payload).toString("hex"),
  ]);
  launchBySequence.push(record.sequence);
}
const reader = fileURLToPath(
  new URL("./exact-projectile-reader.py", import.meta.url),
);
const run = Bun.spawnSync(
  [python, ...pythonArgs, reader, executable, replay.build],
  {
    stdin: Buffer.from(
      JSON.stringify({
        creation,
        components: [],
        controller: [],
        selectMaokaiR: true,
      }),
    ),
  },
);
assert.equal(run.exitCode, 0, run.stderr.toString());
const native = JSON.parse(run.stdout.toString());
const candidateHandles = new Set(native.records.map(({ entity }) => entity));
const actorPackets = new Map(
  Array.from(candidateHandles, (handle) => [handle, []]),
);
for (const { packet, sequence, opcode, context } of packets()) {
  const rows = actorPackets.get(context);
  if (!rows) continue;
  rows.push({
    opcode,
    sequence,
    seconds: packet.timeSeconds,
    bodyBytes: packet.payload.byteLength,
    bodySha256: sha(packet.payload),
  });
}
const candidates = native.records.map((identity) => {
  const stream = actorPackets.get(identity.entity);
  const launch = stream.find(
    ({ sequence }) => sequence === launchBySequence[identity.creationIndex],
  );
  assert(
    launch && launch.opcode === 639,
    "Native launch differs from replay envelope",
  );
  return {
    identity,
    launch,
    subsequentPackets: stream.filter(
      ({ sequence }) => sequence > launch.sequence,
    ),
  };
});
const report = {
  kind: "reviewed-native-maokai-r-launch-discovery",
  build: replay.build,
  protocol: replay.protocol,
  replaySha256: sha(new Uint8Array(bytes)),
  matchSha256: matchSha,
  decoderSha256: native.decoderSha256,
  missileEnvelopes: creation.length,
  unresolvedDescriptors: native.unresolvedDescriptors,
  unsupportedMaokaiLaunches: native.unsupportedMaokaiLaunches,
  candidates,
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(
  JSON.stringify({
    candidateLaunches: candidates.length,
    unresolvedDescriptors: native.unresolvedDescriptors.length,
    unsupportedMaokaiLaunches: native.unsupportedMaokaiLaunches.length,
  }),
);
