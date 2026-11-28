import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { realpath, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { zstdDecompressSync } from "node:zlib";
import { openReplay, replayPacketEnvelopes } from "../../transport.mjs";
import { replayTimedPacketEnvelopes } from "../../replay-packet-clock.mjs";
import { openLocalWad } from "../wad.mjs";
import { readExactMapBin } from "../exact-map-bin.mjs";
import { mapBinHash as hash } from "../map-scene-assets.mjs";

const [replayPath, archive, install, outputStem, python, ...pythonArgs] =
  process.argv.slice(2);
const usage =
  "bun verify-rift-maokai-launches.mjs <original-rofl> <archived-macos-executable> <wad-root> <private-output-stem> <python-command> [python-args …]";
if (replayPath === "--help") {
  console.log(usage);
  process.exit(0);
}
assert(python, usage);
const cache = await realpath(".cache");
const output = resolve(outputStem);
const parent = await realpath(dirname(output));
assert(
  parent === cache || parent.startsWith(cache + sep),
  "Expected a private .cache output",
);
for (const ext of [".json", ".navgrid"]) {
  assert(
    !(await Bun.file(output + ext).exists()),
    "Expected a fresh output stem",
  );
}
const replaySha256 =
  "a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1";
const build = "16.23.841.8428";
const protocol = "8bbfcd5af2bc92db";
const sha = (data) => createHash("sha256").update(data).digest("hex");
const bytes = new Uint8Array(await Bun.file(replayPath).arrayBuffer());
assert.equal(sha(bytes), replaySha256);
const replay = openReplay(bytes.buffer);
assert.equal(replay.build, build);
assert.equal(replay.protocol, protocol);
const maokaiIds = [1073820771, 1073820782, 1073820791, 1073820800, 1073820809];
const heimerIds = [1073821006, 1073821008, 1073821010, 1073821012, 1073821014];
const actorPackets = new Map(
  [...maokaiIds, ...heimerIds].map((id) => [id, []]),
);
const decompress = (input, output) =>
  zstdDecompressSync(input, { maxOutputLength: output.length });
let opcode,
  context,
  sequence = 0;
for (const packet of replayTimedPacketEnvelopes(
  replayPacketEnvelopes(replay, decompress),
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
  if (packet.stream !== 1 || !actorPackets.has(context)) continue;
  actorPackets.get(context).push({
    opcode,
    seconds: packet.timeSeconds,
    sequence,
    clockBits: [packet.firstTimeBits, packet.secondTimeBits],
    payload: Buffer.from(packet.payload).toString("hex"),
    bodySha256: sha(packet.payload),
  });
}

const input = { creation: [], components: [], controller: [] };
const cohorts = [];
for (const [character, spellName, ids, spellSha] of [
  [
    "Maokai",
    "MaokaiRMis",
    maokaiIds,
    "b6d9a1f03f96018c40a3f3d4da2345983ebbe3e15c1c0d934a1bc4dd62e46b8d",
  ],
  [
    "Heimerdinger",
    "HeimerdingerWAttack2",
    heimerIds,
    "eec638a80642c4defc34a12205db270088f177c5867b42ec8c2514ba43e95d94",
  ],
]) {
  const wad = await openLocalWad(
    install,
    `DATA/FINAL/Champions/${character}.wad.client`,
    Bun.zstdDecompressSync,
  );
  const lower = character.toLowerCase();
  const base = readExactMapBin(
    await wad(`data/characters/${lower}/${lower}.bin`),
  );
  const f = (obj, name) =>
    obj?.fields?.[hash(name)]?.value ?? obj?.fields?.[hash(name)];
  const spell = base.objects.find(
    (obj) =>
      obj.classHash === hash("SpellObject") &&
      [f(obj, "ObjectName"), f(obj, "mScriptName")].includes(spellName),
  );
  const spec = f(f(spell, "mSpell"), "mMissileSpec");
  const movement = f(spec, "movementComponent");
  assert.equal(movement.classHash, hash("AcceleratingMovement"));
  assert.equal(f(movement, "mTracksTarget"), false);
  assert.equal(f(movement, "mUseHeightOffsetAtEnd"), true);
  assert.equal(base.sourceSha256, spellSha);

  const events = [];
  for (const id of ids) {
    const packets = actorPackets.get(id);
    const [launch] = packets.filter((row) => row.opcode === 639);
    assert.equal(packets.filter((row) => row.opcode === 639).length, 1);
    const stops = packets.filter((row) => row.opcode === 479);
    const components = packets.filter((row) => row.opcode === 784);
    assert.equal(packets.filter((row) => row.opcode === 337).length, 0);
    assert(stops.every((row) => row.payload.length === 0));
    input.creation.push([id, launch.payload]);
    for (const row of components.filter((row) => row.payload.length === 36)) {
      input.components.push([id, row.payload]);
    }
    const otherActorPackets = packets.filter(
      (row) => ![66, 479, 639, 682, 784].includes(row.opcode),
    );
    events.push({
      id,
      launch,
      stops,
      components,
      otherActorPackets,
      opcodeInventory: Object.fromEntries(
        [...new Set(packets.map((row) => row.opcode))].map((op) => [
          op,
          packets.filter((row) => row.opcode === op).length,
        ]),
      ),
    });
  }
  cohorts.push({
    character,
    spellName,
    baseSha256: base.sourceSha256,
    movement,
    events,
  });
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
  native.records.map((row) => row.entity),
  [...maokaiIds, ...heimerIds],
);

const map = await openLocalWad(
  install,
  "DATA/FINAL/Maps/Shipping/Map11.wad.client",
  Bun.zstdDecompressSync,
);
const navgrid = await map(
  "assets/maps/navgrid/map11/aipath_srx_3.aimesh_ngrid",
);
const navgridSha256 = sha(navgrid);
assert.equal(
  navgridSha256,
  "28f6738003e01a0c13fa8a2f859d2947a8743606465b42139a24c423dd311bd9",
);
await writeFile(output + ".navgrid", navgrid, { flag: "wx" });
await writeFile(
  output + ".json",
  JSON.stringify(
    {
      build,
      protocol,
      replaySha256,
      navgridSha256,
      cohorts,
      native,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
for (const cohort of cohorts) {
  console.log(
    cohort.spellName,
    cohort.baseSha256,
    cohort.events.map((row) => [
      row.id,
      row.launch.seconds,
      row.stops.map((stop) => stop.seconds),
      row.components.map((contact) => contact.seconds),
    ]),
  );
}
console.log("Map11 navgrid", navgridSha256);
