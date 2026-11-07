import { resolve } from "node:path";
import { createLatestMissileTargetInputs } from "../latest-missile-targets.mjs";
import { createLatestFieldReader } from "../latest-fields.mjs";
import { sha256 } from "../structural-comparison.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const inputs = {};
const bytes = async (path) => {
  const raw = await Bun.file(path).bytes();
  const hash = await sha256(raw);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Missile target comparison input changed: ${path}`);
  inputs[path] = hash;
  return raw;
};
const read = async (path) =>
  JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(await bytes(path)),
  );
for (const name of [
  "tools/inspect-missile-targets.mjs",
  "latest-missile-targets.mjs",
  "latest-fields.mjs",
  "latest-cast-indexed-overrides.mjs",
  "movement-records.mjs",
  "structural-comparison.mjs",
  "structural-decoder.mjs",
  "native-decoder.mjs",
])
  await bytes(resolve(import.meta.dir, "..", name));
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`);
const image = await bytes(`${cache}/public/decoder-16.21-macos/image.bin`);
const packageBytes = await bytes(
  `${cache}/public/latest-missile-targets/package.json`,
);
const codecBytes = await bytes(
  `${cache}/public/decoder-16.21-macos/field-codecs.json`,
);
if ((await sha256(codecBytes)) !== profile.fieldCodecsSha256)
  throw Error("Missile target packet field codecs differ");
const fields = createLatestFieldReader(
  profile,
  JSON.parse(new TextDecoder().decode(codecBytes)),
);
const targetInputs = await createLatestMissileTargetInputs({
  profile,
  image,
  packageBytes,
});
const native = await read(`${cache}/research/missile-targets-native.json`);
if (
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest
)
  throw Error("Native missile target evidence build differs");
for (const [path, expected] of Object.entries(native.inputs))
  if ((await sha256(await bytes(path))) !== expected)
    throw Error(`Native missile target producer/input changed: ${path}`);
const sources = new Map();
const results = [];
let targetCount = 0;
for (const record of native.records) {
  if (!sources.has(record.source))
    sources.set(record.source, await read(record.source));
  const original = sources.get(record.source).observations[record.key];
  if (
    original?.status !== "complete" ||
    original.opcode !== record.opcode ||
    original.payloadSha256 !== record.payloadSha256
  )
    throw Error("Native target source packet differs");
  const observation = {
    complete: true,
    object: Uint8Array.from(Buffer.from(original.object, "hex")),
    heap: Uint8Array.from(Buffer.from(original.heap, "hex")),
  };
  const cast =
    record.opcode === 28
      ? fields.missile(observation).cast
      : fields.cast(observation);
  if (
    cast.targetCount !== record.targetCount ||
    cast.uninterpretedTargetEntries !== record.entriesHex
  )
    throw Error("Browser/native target vector extraction differs");
  const targets = targetInputs.read(
    cast.uninterpretedTargetEntries,
    cast.targetCount,
  );
  if (
    JSON.stringify(targets.map((target) => target.requestedEntityId)) !==
    JSON.stringify(record.requestedEntityIds)
  )
    throw Error("Browser requested target IDs differ from original conversion");
  if (
    !Object.isFrozen(targets) ||
    targets.some(
      (target) => !Object.isFrozen(target) || target.acceptedEntityId !== null,
    )
  )
    throw Error(
      "Requested target identities must remain immutable and unaccepted",
    );
  targetCount += targets.length;
  results.push({
    key: record.key,
    source: record.source,
    opcode: record.opcode,
    targets,
  });
}
for (const control of native.unsignedBoundaryControls) {
  const targets = targetInputs.read(control.entriesHex, 1);
  if (
    targets[0].requestedEntityId !== control.requestedEntityId ||
    targets[0].acceptedEntityId !== null
  )
    throw Error("Original unsigned target boundary conversion differs");
}
if (
  native.nativeExecutions !==
    targetCount + native.unsignedBoundaryControls.length ||
  !targetCount ||
  !results.length
)
  throw Error("Missing native requested-target coverage");
let rejectedBoundaries = 0;
const rejects = async (operation) => {
  let rejected = false;
  try {
    await operation();
  } catch {
    rejected = true;
  }
  if (!rejected) throw Error("Incompatible missile target input was accepted");
  rejectedBoundaries++;
};
await rejects(() =>
  createLatestMissileTargetInputs({
    profile: { ...profile, clientVersion: "foreign" },
    image,
    packageBytes,
  }),
);
await rejects(() =>
  createLatestMissileTargetInputs({
    profile,
    image,
    packageBytes: new Uint8Array(),
  }),
);
await rejects(() => targetInputs.read("", 1));
await rejects(() => targetInputs.read("00".repeat(16), 1));
await rejects(() => targetInputs.read("gg".repeat(16), 1));
await rejects(() => targetInputs.read("", 65537));
await rejects(() => targetInputs.read("", -1));
if (targetInputs.read("", 0).length !== 0)
  throw Error("Empty target list changed");
for (const [path, expected] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== expected)
    throw Error(`Missile target input changed during comparison: ${path}`);
const output = `${cache}/research/missile-targets-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      build: native.build,
      protocol: native.protocol,
      packets: results.length,
      targets: targetCount,
      unsignedBoundaryControls: native.unsignedBoundaryControls.length,
      rejectedBoundaries,
      results,
      inputs,
      scope: {
        browserCompatibleJavaScript: true,
        actualBrowserExecuted: false,
        nativeRequestedIdAgreement: true,
        worldTargetAccepted: false,
        targetTrackingVerified: false,
        movementEligibilityExpanded: false,
        mainViewerExpanded: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    packets: results.length,
    targets: targetCount,
    unsignedBoundaryControls: native.unsignedBoundaryControls.length,
    rejectedBoundaries,
    currentInputFingerprints: Object.keys(inputs).length,
  }),
);
