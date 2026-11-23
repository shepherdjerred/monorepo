// Derived validation input. Original replication bodies and cursor identities
// remain intact; no native frame scheduling or pre-observation value is added.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { createLatestCombatStatReader } from "../latest-combat-stats.mjs";

const [reportPath, publicRoot, outputPath] = process.argv.slice(2);
if (!reportPath || !publicRoot || !outputPath || process.argv.length !== 5)
  throw Error(
    "Usage: bun prepare-animation-move-speed-input.mjs <semantic-report.json> <approved-public> <output.json>",
  );
const inputs = {};
async function raw(file) {
  file = resolve(file);
  const bytes = await Bun.file(file).bytes();
  inputs[file] = { bytes: bytes.length, sha256: await sha256(bytes) };
  return bytes;
}
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
const report = decode(await raw(reportPath));
const profile = decode(
  await raw(`${publicRoot}/decoder-16.21-macos/profile.json`),
);
const reader = await createLatestCombatStatReader(
  profile,
  await raw(`${publicRoot}/decoder-16.21-macos/image.bin`),
  await raw(`${publicRoot}/latest-champion-state/package.json`),
  await raw(`${publicRoot}/latest-combat-stats/package.json`),
);
const field = reader.metadata.fields.field_17a0;
if (
  report.build !== profile.clientVersion ||
  report.protocol !== profile.protocolDigest ||
  field.group !== 32 ||
  field.index !== 24 ||
  field.offset !== 0x17a0 ||
  field.cacheOffset !== 0x28c
)
  throw Error("Exact original MoveSpeed replicated/cache lineage required");
const heroes = new Set(report.heroes.map((hero) => hero.entityId));
if (heroes.size !== 10)
  throw Error("Ten original startup hero identities required");
const key = (record) =>
  [
    record.entityId,
    record.time,
    record.transportSequence,
    record.recordIndex,
  ].join(":");
const bits = (value) => {
  const data = new DataView(new ArrayBuffer(4));
  data.setFloat32(0, value, true);
  return data.getUint32(0, true);
};
const updates = new Map();
for (const update of report.combatStatUpdates) {
  if (!Object.hasOwn(update, "moveSpeed")) continue;
  if (updates.has(key(update)))
    throw Error("Duplicate recorded MoveSpeed cursor");
  updates.set(key(update), bits(update.moveSpeed));
}
const known = new Map(),
  firstObserved = {},
  records = [];
let observed = 0;
for (const record of [...report.replicationRecords].sort(
  (a, b) =>
    a.time - b.time ||
    a.transportSequence - b.transportSequence ||
    a.recordIndex - b.recordIndex,
)) {
  if (!heroes.has(record.entityId)) continue;
  const groups = record.groups.filter((group) => group.group === 32);
  if (!groups.length) continue;
  const selected = { ...record, groups },
    decoded = reader.read(selected);
  if (Object.hasOwn(decoded.consumerBits, "field_17a0")) {
    const current = decoded.consumerBits.field_17a0;
    if (!updates.has(key(record)) || updates.get(key(record)) !== current)
      throw Error(
        "Recorded combat MoveSpeed differs from original raw-stat input",
      );
    updates.delete(key(record));
    known.set(record.entityId, current);
    observed++;
    firstObserved[record.entityId] ??= {
      time: record.time,
      transportSequence: record.transportSequence,
      recordIndex: record.recordIndex,
      bits: current,
    };
  }
  records.push({
    entityId: record.entityId,
    time: record.time,
    transportSequence: record.transportSequence,
    recordIndex: record.recordIndex,
    stream: record.stream,
    groups,
    moveSpeedWritten: Object.hasOwn(decoded.consumerBits, "field_17a0"),
    expectedBits: known.get(record.entityId) ?? null,
  });
}
if (updates.size || Object.keys(firstObserved).length !== heroes.size)
  throw Error(
    "Complete original MoveSpeed update/first-observation coverage required",
  );
await Bun.write(
  resolve(outputPath),
  JSON.stringify(
    {
      schema: 1,
      kind: "derived-original-animation-move-speed-input",
      build: profile.clientVersion,
      protocol: profile.protocolDigest,
      decoderImageSha256: profile.decoderImageSha256,
      combatStatPackageSha256: report.combatStatPackageSha256,
      inputs,
      preparerSha256: await sha256(await Bun.file(import.meta.path).bytes()),
      heroIds: [...heroes],
      firstObserved,
      observed,
      records,
      scope: {
        originalReplicationBodiesRetained: true,
        beforeFirstObservation: "unavailable",
        nativeFrameSchedulingEstablished: false,
        nativeGraphInputsAdmitted: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    records: records.length,
    observed,
    heroes: heroes.size,
    firstObserved,
  }),
);
