import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createLatestTargetVisibilityInputs } from "../latest-target-visibility.mjs";
import { StructuralDecoder } from "../structural-decoder.mjs";
import { sha256 } from "../structural-comparison.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
const bytes = async (path) => {
  const raw = await Bun.file(path).bytes(),
    digest = await sha256(raw);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Visibility input changed: ${path}`);
  inputs[path] = digest;
  return raw;
};
const read = async (path) =>
  JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(await bytes(path)),
  );
for (const path of [
  import.meta.path,
  resolve(import.meta.dir, "../latest-target-visibility.mjs"),
  resolve(import.meta.dir, "../structural-decoder.mjs"),
  resolve(import.meta.dir, "../structural-comparison.mjs"),
  resolve(import.meta.dir, "../native-decoder.mjs"),
  resolve(import.meta.dir, "prepare-target-visibility.py"),
  resolve(import.meta.dir, "observe-structural.py"),
  resolve(import.meta.dir, "sample-structural.mjs"),
  resolve(import.meta.dir, "sample-target-visibility.mjs"),
])
  await bytes(path);
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await bytes(`${cache}/public/decoder-16.21-macos/image.bin`),
  constructors = await bytes(
    `${cache}/public/decoder-16.21-macos/constructors.bin`,
  ),
  packageBytes = await bytes(
    `${cache}/public/latest-target-visibility/package.json`,
  ),
  samples = await read(
    `${cache}/research/target-visibility-reconstruction-input.json`,
  ),
  native = await read(
    `${cache}/research/target-visibility-reconstruction-native.json`,
  );
if (
  native.clientVersion !== profile.clientVersion ||
  native.decoderImageSha256 !== profile.decoderImageSha256 ||
  native.constructorImageSha256 !== profile.constructorImageSha256 ||
  samples.build !== profile.clientVersion ||
  samples.protocol !== profile.protocolDigest ||
  (await sha256(constructors)) !== profile.constructorImageSha256
)
  throw Error(
    "Original raw visibility fixtures differ from the exact decoder build",
  );
const runtimePath = `${cache}/public/vendor/unicorn_x86_candidate.mjs`,
  runtimeManifest = await read(runtimePath.replace(/\.mjs$/, ".json"));
if ((await sha256(await bytes(runtimePath))) !== runtimeManifest.sha256)
  throw Error("Visibility comparison runtime differs");
for (const [path, expected] of Object.entries(samples.inputs))
  if ((await sha256(await bytes(path))) !== expected)
    throw Error(`Visibility sampling evidence changed: ${path}`);
const { default: createUnicorn } = await import(pathToFileURL(runtimePath));
const reader = await createLatestTargetVisibilityInputs({
  profile,
  image,
  packageBytes,
});
const decoder = new StructuralDecoder(
  await createUnicorn(),
  profile,
  image,
  constructors,
);
const records = [];
let primaryBytes = 0,
  secondaryBytes = 0,
  firstObservation;
try {
  for (const [key, sample] of Object.entries(samples.packets)) {
    const original = native.observations[key],
      payload = Uint8Array.from(Buffer.from(sample.payloadHex, "hex"));
    if (
      sample.opcode !== 822 ||
      original?.status !== "complete" ||
      original.opcode !== 822 ||
      original.param !== sample.param ||
      original.payloadSha256 !== (await sha256(payload))
    )
      throw Error("Original visibility packet identity differs");
    const observed = decoder.observePacket(822, payload, sample.param);
    if (
      !observed.complete ||
      Buffer.from(observed.object).toString("hex") !== original.object ||
      Buffer.from(observed.heap).toString("hex") !== original.heap
    )
      throw Error(
        "Browser-compatible visibility packet differs from original native bytes",
      );
    firstObservation ??= structuredClone(observed);
    const decoded = reader.read(observed);
    const obj = Buffer.from(original.object, "hex"),
      heap = Buffer.from(original.heap, "hex");
    for (const [name, at] of [
      ["primaryPayloadHex", 16],
      ["secondaryPayloadHex", 32],
    ]) {
      const pointer = obj.readBigUInt64LE(at),
        length = obj.readUInt32LE(at + 8),
        offset = Number(pointer - 0x10200000n);
      const expected = length
        ? heap.subarray(offset, offset + length).toString("hex")
        : "";
      if (decoded[name] !== expected)
        throw Error(`Original raw visibility vector differs: ${name}`);
    }
    if (
      decoded.entityId !== sample.param ||
      decoded.visible !== null ||
      decoded.acceptedByLiveUnit !== null
    )
      throw Error(
        "Raw visibility request escaped its unknown live acceptance boundary",
      );
    primaryBytes += decoded.primaryPayloadHex.length / 2;
    secondaryBytes += decoded.secondaryPayloadHex.length / 2;
    records.push({
      key,
      time: sample.time,
      stream: sample.stream,
      chunkId: sample.chunkId,
      blockOffset: sample.blockOffset,
      transportSequence: sample.transportSequence,
      payloadSha256: original.payloadSha256,
      ...decoded,
    });
  }
} finally {
  decoder.close();
}
if (!records.length) throw Error("Missing original visibility packet coverage");
let rejectedBoundaries = 0;
const rejects = async (operation) => {
  let rejected = false;
  try {
    await operation();
  } catch {
    rejected = true;
  }
  if (!rejected) throw Error("Malformed raw visibility input was admitted");
  rejectedBoundaries++;
};
await rejects(() =>
  createLatestTargetVisibilityInputs({
    profile: { ...profile, clientVersion: "foreign" },
    image,
    packageBytes,
  }),
);
await rejects(() =>
  createLatestTargetVisibilityInputs({
    profile,
    image,
    packageBytes: new Uint8Array(),
  }),
);
await rejects(() => reader.read({ ...firstObservation, complete: false }));
for (const edit of [
  (view) => view.setBigUint64(0, 0n, true),
  (view) => view.setUint32(24, 0xffffffff, true),
  (view) => view.setBigUint64(16, 0x10200000n, true),
  (view) => view.setUint32(28, 0xffffffff, true),
]) {
  const observation = structuredClone(firstObservation);
  edit(
    new DataView(
      observation.object.buffer,
      observation.object.byteOffset,
      observation.object.byteLength,
    ),
  );
  observation.heap.set(observation.object);
  await rejects(() => reader.read(observation));
}
for (const [path, expected] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== expected)
    throw Error(`Visibility evidence input changed: ${path}`);
const output = `${cache}/research/target-visibility-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      build: profile.clientVersion,
      protocol: profile.protocolDigest,
      packets: records.length,
      primaryBytes,
      secondaryBytes,
      rejectedBoundaries,
      records,
      inputs,
      scope: {
        browserCompatibleDecoderExecuted: true,
        actualBrowserExecuted: false,
        rawOwnerPayloadsOnly: true,
        liveVisibilityAccepted: false,
        movementEligibilityExpanded: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    packets: records.length,
    primaryBytes,
    secondaryBytes,
    rejectedBoundaries,
    inputFingerprintsVerified: Object.keys(inputs).length,
  }),
);
