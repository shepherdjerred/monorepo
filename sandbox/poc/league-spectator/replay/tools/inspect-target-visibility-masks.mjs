import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createLatestTargetVisibilityMaskInputs } from "../latest-target-visibility-masks.mjs";
import { StructuralDecoder } from "../structural-decoder.mjs";
import { sha256 } from "../structural-comparison.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
const bytes = async (path) => {
  const raw = await Bun.file(path).bytes(),
    digest = await sha256(raw);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Mask input changed: ${path}`);
  inputs[path] = digest;
  return raw;
};
const read = async (path) =>
  JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(await bytes(path)),
  );
for (const name of [
  "tools/inspect-target-visibility-masks.mjs",
  "tools/sample-target-visibility-masks.mjs",
  "tools/prepare-target-visibility-masks.py",
  "tools/observe-structural.py",
  "latest-target-visibility-masks.mjs",
  "latest-target-visibility-masks.test.mjs",
  "structural-decoder.mjs",
  "structural-comparison.mjs",
  "native-decoder.mjs",
])
  await bytes(resolve(import.meta.dir, "..", name));
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await bytes(`${cache}/public/decoder-16.21-macos/image.bin`),
  constructors = await bytes(
    `${cache}/public/decoder-16.21-macos/constructors.bin`,
  ),
  packageBytes = await bytes(
    `${cache}/public/latest-target-visibility-masks/package.json`,
  ),
  samples = await read(`${cache}/research/target-visibility-masks-input.json`),
  native = await read(`${cache}/research/target-visibility-masks-native.json`);
if (
  native.clientVersion !== profile.clientVersion ||
  native.decoderImageSha256 !== profile.decoderImageSha256 ||
  native.constructorImageSha256 !== profile.constructorImageSha256 ||
  samples.build !== profile.clientVersion ||
  samples.protocol !== profile.protocolDigest ||
  (await sha256(constructors)) !== profile.constructorImageSha256
)
  throw Error("Original visibility mask fixtures differ from decoder build");
for (const [path, expected] of Object.entries(samples.inputs))
  if ((await sha256(await bytes(path))) !== expected)
    throw Error(`Stale mask sample: ${path}`);
const runtimePath = `${cache}/public/vendor/unicorn_x86_candidate.mjs`,
  runtimeManifest = await read(runtimePath.replace(/\.mjs$/, ".json"));
if ((await sha256(await bytes(runtimePath))) !== runtimeManifest.sha256)
  throw Error("Mask runtime differs");
const { default: createUnicorn } = await import(pathToFileURL(runtimePath));
const reader = await createLatestTargetVisibilityMaskInputs({
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
const records = [],
  controls = [];
try {
  for (const [key, sample] of Object.entries(samples.packets)) {
    const original = native.observations[key],
      payload = Uint8Array.from(Buffer.from(sample.payloadHex, "hex"));
    if (
      !reader.opcodes.includes(sample.opcode) ||
      original?.status !== "complete" ||
      original.opcode !== sample.opcode ||
      original.param !== sample.param ||
      original.payloadSha256 !== (await sha256(payload))
    )
      throw Error("Original mask packet identity differs");
    const observed = decoder.observePacket(
      sample.opcode,
      payload,
      sample.param,
    );
    if (
      !observed.complete ||
      Buffer.from(observed.object).toString("hex") !== original.object ||
      Buffer.from(observed.heap).toString("hex") !== original.heap
    )
      throw Error("Browser-compatible mask decoder differs from native bytes");
    const decoded = reader.read(observed),
      object = Buffer.from(original.object, "hex");
    if (
      decoded.entityId !== sample.param ||
      decoded.opcode !== sample.opcode ||
      decoded.rawObjectHex !== original.object ||
      decoded.visible !== null ||
      decoded.acceptedByLiveUnit !== null ||
      (sample.opcode === 918
        ? decoded.encodedViewSlotByte !== undefined
        : decoded.encodedViewSlotByte !== object[16])
    )
      throw Error("Raw mask field/acceptance boundary differs");
    const record = {
      key,
      time: sample.time,
      stream: sample.stream,
      chunkId: sample.chunkId,
      blockOffset: sample.blockOffset,
      transportSequence: sample.transportSequence,
      payloadSha256: original.payloadSha256,
      ...decoded,
    };
    if (sample.control) controls.push(record);
    else records.push(record);
  }
} finally {
  decoder.close();
}
if (controls.length !== 1 || controls[0].opcode !== 918 || !records.length)
  throw Error("Original 918 decoder control or replay mask records missing");
const byOpcode = Object.fromEntries(
  reader.opcodes.map((opcode) => [
    opcode,
    records.filter((r) => r.opcode === opcode).length,
  ]),
);
for (const [path, expected] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== expected)
    throw Error(`Mask evidence changed: ${path}`);
const output = `${cache}/research/target-visibility-masks-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      build: profile.clientVersion,
      protocol: profile.protocolDigest,
      packets: records.length,
      byOpcode,
      controls,
      records,
      inputs,
      scope: {
        browserCompatibleDecoderExecuted: true,
        actualBrowserExecuted: false,
        snapshotGameplayStreamsSeparate: true,
        acceptedLiveVisibility: false,
        liveComponentRoutingAccepted: false,
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
    byOpcode,
    controls: controls.length,
    snapshots: records.filter((r) => r.stream === 2).length,
  }),
);
