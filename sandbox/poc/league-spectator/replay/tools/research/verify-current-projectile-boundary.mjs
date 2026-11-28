import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { realpath, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { zstdDecompressSync } from "node:zlib";
import { replayTimedPacketEnvelopes } from "../../replay-packet-clock.mjs";
import { openReplay, replayPacketEnvelopes } from "../../transport.mjs";

const [replayPath, archive, output, python, ...pythonArgs] =
  process.argv.slice(2);
assert(python, "Expected replay, archive, private receipt, and Python command");
const cache = await realpath(".cache");
const destination = resolve(output);
const parent = await realpath(dirname(destination));
assert(parent === cache || parent.startsWith(cache + sep));

const build = "16.23.841.8428";
const protocol = "8bbfcd5af2bc92db";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const replayBytes = await Bun.file(replayPath).arrayBuffer();
const replaySha256 = sha256(new Uint8Array(replayBytes));
assert.equal(
  replaySha256,
  "a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1",
);
const replay = openReplay(replayBytes);
assert.equal(replay.protocol, protocol);
assert.equal(replay.build, build);

const ids = [1073821006, 1073821008, 1073821010, 1073821012, 1073821014];
const byActor = new Map(ids.map((id) => [id, []]));
const inflate = (input, target) =>
  zstdDecompressSync(input, { maxOutputLength: target.byteLength });
let opcode = null;
let context = 0;
let sequence = 0;
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
  if (packet.stream !== 1 || !byActor.has(context)) continue;
  assert.notEqual(opcode, 337, "Unexpected recorded controller input");
  if ([639, 479, 784].includes(opcode)) {
    byActor.get(context).push({ packet, opcode, sequence });
  }
}
const input = { creation: [], components: [], controller: [] };
const receipts = [];
const describe = ({ packet, opcode, sequence }) => ({
  opcode,
  sequence,
  seconds: packet.timeSeconds,
  clockBits: [packet.firstTimeBits, packet.secondTimeBits],
  chunkOffset: packet.chunkOffset,
  blockOffset: packet.blockOffset,
  bodyBytes: packet.payload.byteLength,
  bodySha256: sha256(packet.payload),
});
for (const [id, rows] of byActor) {
  assert.deepEqual(
    rows.map((row) => row.opcode),
    [639, 479, 784],
  );
  const [launch, stop, contact] = rows.map(describe);
  assert.equal(launch.seconds, 1715.4344140625);
  assert(launch.sequence < stop.sequence);
  assert.equal(stop.sequence + 1, contact.sequence);
  assert.equal(stop.seconds, 1715.5684140625);
  assert.equal(contact.seconds, stop.seconds);
  assert.deepEqual(
    [launch.bodyBytes, stop.bodyBytes, contact.bodyBytes],
    [233, 0, 18],
  );
  input.creation.push([
    id,
    Buffer.from(rows[0].packet.payload).toString("hex"),
  ]);
  input.components.push([
    id,
    Buffer.from(rows[2].packet.payload).toString("hex"),
  ]);
  receipts.push({ entity: id, launch, stop, contact });
}

const reader = fileURLToPath(
  new URL("./exact-projectile-reader.py", import.meta.url),
);
const result = Bun.spawnSync([python, ...pythonArgs, reader, archive, build], {
  stdin: Buffer.from(JSON.stringify(input)),
});
assert.equal(result.exitCode, 0, result.stderr.toString());
const native = JSON.parse(result.stdout.toString());
assert.deepEqual(
  native.records.map(({ entity }) => entity),
  ids,
);
assert.equal(native.componentVectors.length, ids.length);
for (const [index, receipt] of receipts.entries()) {
  const launch = native.records[index];
  assert.equal(launch.sourceName, "Heimerdinger");
  assert.equal(launch.sourceContext, 1073742161);
  assert.equal(launch.requestedMissileSpellHash, 0x0cf47e72);
  assert.equal(launch.packetElapsedSeconds, 0);
  assert.deepEqual(
    native.componentVectors[index],
    [1073742170, 11746, 0, 11416],
  );
  receipt.nativeLaunch = launch;
  receipt.nativeContactArguments = native.componentVectors[index];
}

await writeFile(
  destination,
  JSON.stringify(
    {
      build,
      protocol,
      replaySha256,
      decoderSha256: native.decoderSha256,
      motionCoverage: "recorded launch and contact only",
      receipts,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
