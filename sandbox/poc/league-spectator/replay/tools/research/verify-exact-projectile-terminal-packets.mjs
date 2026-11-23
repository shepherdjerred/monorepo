import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { zstdDecompressSync } from "node:zlib";
import { replayTimedPacketEnvelopes } from "../../replay-packet-clock.mjs";
import { openReplay, replayPacketEnvelopes } from "../../transport.mjs";
import { readExactMapBin } from "../exact-map-bin.mjs";
import { mapBinHash } from "../map-scene-assets.mjs";
import { openLocalWad } from "../wad.mjs";

const [replayPath, sourcePath, archiveRoot] = process.argv.slice(2);
assert(
  replayPath && sourcePath && archiveRoot,
  "Usage: bun verify-exact-projectile-terminal-packets.mjs <short-rofl> <projectile-source-receipt> <archive-root>",
);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const replayBytes = await Bun.file(replayPath).arrayBuffer();
const replaySha256 = digest(new Uint8Array(replayBytes));
assert.equal(
  replaySha256,
  "d7cabb0b7ba965f317863d128238847a0b9b0e4cc0cdbcfa3077c537b10fdf2b",
);
const replay = openReplay(replayBytes);
const sourceBytes = await Bun.file(sourcePath).bytes();
const source = JSON.parse(Buffer.from(sourceBytes).toString());
assert.equal(replay.build, source.build);
assert.equal(replay.protocol, source.protocol);
assert.equal(replaySha256, source.replaySha256);

const events = source.events.filter(
  ({ missileSpell }) => missileSpell === "ZoeQMis2",
);
assert.deepEqual(
  events.map(({ entity }) => entity),
  [1073742880, 1073743207],
);
const packets = new Map(events.map(({ entity }) => [entity, []]));
let opcode = null;
let context = 0;
let ordinal = 0;
const inflate = (input, target) =>
  zstdDecompressSync(input, { maxOutputLength: target.byteLength });
for (const packet of replayTimedPacketEnvelopes(
  replayPacketEnvelopes(replay, inflate),
)) {
  ordinal++;
  if (packet.blockOffset === 0) {
    opcode = null;
    context = 0;
  }
  opcode = packet.explicitOpcode ?? opcode;
  context =
    packet.marker & 32
      ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
      : packet.paramBits;
  if (packet.stream !== 1 || !packets.has(context)) continue;
  packets.get(context).push({
    ordinal,
    opcode,
    timeSeconds: packet.timeSeconds,
    bodySha256: digest(packet.payload),
    bodyBytes: packet.payload.length,
  });
}

const cases = events.map((event) => {
  const rows = packets.get(event.entity);
  const creation = rows.filter(({ opcode }) => opcode === 639);
  const stops = rows.filter(({ opcode }) => opcode === 479);
  const collisions = rows.filter(({ opcode }) => opcode === 784);
  assert.equal(creation.length, 1);
  assert.equal(stops.length, 1);
  assert.equal(collisions.length, 1);
  const [stop] = stops;
  const [collision] = collisions;
  const [decodedCollision] = event.componentEvents;
  assert.equal(creation[0].bodySha256, event.creation.bodySha256);
  assert.equal(creation[0].timeSeconds, event.creation.timeSeconds);
  assert.equal(stop.bodyBytes, 0);
  assert.equal(stop.timeSeconds, event.presentationStop.timeSeconds);
  assert.equal(collision.timeSeconds, stop.timeSeconds);
  assert.equal(collision.bodySha256, decodedCollision.bodySha256);
  assert.deepEqual(rows.slice(-2), [stop, collision]);
  return {
    entity: event.entity,
    creation: creation[0],
    stop,
    collision: {
      ...collision,
      entityArgument: decodedCollision.entityArgument,
      vector: decodedCollision.vector,
    },
    birthToStopSeconds: stop.timeSeconds - creation[0].timeSeconds,
  };
});

const [missile] = source.assets.filter(({ spell }) => spell === "ZoeQMis2");
const wad = await openLocalWad(
  archiveRoot,
  "DATA/FINAL/Champions/Zoe.wad.client",
  Bun.zstdDecompressSync,
);
const field = (object, name) => object.fields[mapBinHash(name)];
const base = readExactMapBin(await wad(missile.spellSource.path));
assert.equal(base.sourceSha256, missile.spellSource.sha256);
const spell = base.objects.find(
  ({ pathHash }) => pathHash === missile.spellObjectPathHash,
);
const spellData = field(spell, "mSpell");
const hitKey = field(spellData, "mHitEffectKey");
const hitBone = field(spellData, "mHitBoneName");
assert.deepEqual(hitKey, { type: "Hash", value: 0x7b67335d });
assert.deepEqual(hitBone, { type: "String", value: "root" });
const skin = readExactMapBin(await wad(missile.skin.path));
assert.equal(skin.sourceSha256, missile.skin.sha256);
const resolver = skin.objects.find(
  ({ classHash }) => classHash === mapBinHash("ResourceResolver"),
);
const hitLink = field(resolver, "resourceMap").entries.find(
  ({ key }) => key.value === hitKey.value,
);
assert.deepEqual(hitLink.value, { type: "ObjectLink", value: 0xbddef470 });
const hitArchive = readExactMapBin(await wad(missile.effect.source.path));
assert.equal(hitArchive.sourceSha256, missile.effect.source.sha256);
const hit = hitArchive.objects.find(({ pathHash }) => pathHash === "bddef470");
assert.equal(hit.classHash, mapBinHash("VfxSystemDefinitionData"));
assert.equal(field(hit, "particleName").value, "Zoe_Skin20_Q_Hit");
const hitEmitters = field(hit, "complexEmitterDefinitionData").elements.length;
assert.equal(hitEmitters, 7);

console.log(
  JSON.stringify(
    {
      build: replay.build,
      protocol: replay.protocol,
      replaySha256,
      sourceReceiptSha256: digest(sourceBytes),
      inspectedEnvelopes: ordinal,
      cases,
      authoredHit: {
        key: "7b67335d",
        resourceLink: "bddef470",
        name: "Zoe_Skin20_Q_Hit",
        boneName: hitBone.value,
        emitters: hitEmitters,
        archiveSha256: hitArchive.sourceSha256,
        staticNativeBoundaries: {
          collisionChild: 0x88f270,
          resolvedTargetPosition: 0x8cebdf,
          hitBonePosition: 0x87a100,
          zeroVelocityDirectionFallback: 0x8cf2b3,
        },
      },
      scope:
        "Saved stream 1 creation, final stop/collision order and linked authored hit resource. Static native impact branches can read live target and bone positions, and can derive direction from live target and source positions after stop zeroes missile velocity. Replay impact placement, frame times, local cleanup and pixels remain outside this proof.",
    },
    null,
    2,
  ),
);
