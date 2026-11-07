import { resolve } from "node:path";
import {
  queryConstructorViewTargetPredicate,
  readPresentationBaseFlags,
  PRESENTATION_TARGET_ASSUMPTIONS,
  PRESENTATION_TARGET_OMISSIONS,
} from "../latest-presentation-targets.mjs";
import { sha256 } from "../structural-comparison.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
const raw = async (path) => {
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Target proof input changed: ${path}`);
  inputs[path] = hash;
  return bytes;
};
const native = JSON.parse(
  new TextDecoder().decode(
    await raw(`${cache}/research/missile-target-gates-native.json`),
  ),
);
if (
  native.build !== "16.21.829.8620" ||
  native.protocol !== "20e09df23c66b85e" ||
  native.kind !== "original-target-predicate-constructor-view-controls" ||
  native.preconditions.baseFlagsC50 !== 15 ||
  native.preconditions.externalFlagsProviderC68 !== 0 ||
  native.preconditions.localPlayer2562970 !== 0 ||
  native.preconditions.linkedNetworkIdB38 !== 0 ||
  native.preconditions.bypass2562969 !== 0 ||
  native.preconditions.byte38cd !== 0 ||
  native.scope.actualNativeTargetAcceptanceRecovered !== false
)
  throw Error("Scoped original constructor-view target controls required");
for (const [path, hash] of Object.entries(native.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error(`Native target input changed: ${path}`);
for (const [name, hash] of Object.entries(native.sources))
  if ((await sha256(await raw(resolve(import.meta.dir, name)))) !== hash)
    throw Error(`Native target producer changed: ${name}`);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
if ((await sha256(image)) !== native.decoderImageSha256)
  throw Error("Original target image changed");
for (const block of native.blocks)
  if (
    (await sha256(image.subarray(block.rva, block.rva + block.bytes))) !==
    block.sha256
  )
    throw Error(`Original target instructions changed: ${block.label}`);
for (const table of native.radiusVirtualTables)
  if (
    table.targetRva !== 0xd2240 ||
    (await sha256(
      image.subarray(
        table.vtableRva + table.slot,
        table.vtableRva + table.slot + 8,
      ),
    )) !== table.sha256
  )
    throw Error("Original class target-radius method changed");
for (const file of [
  import.meta.path,
  resolve(import.meta.dir, "../latest-presentation-targets.mjs"),
  resolve(import.meta.dir, "../latest-champion-state.mjs"),
  resolve(import.meta.dir, "../structural-comparison.mjs"),
])
  await raw(file);
const mismatches = [];
const varuint = JSON.parse(
  new TextDecoder().decode(
    await raw(`${cache}/research/target-baseflag-varuint-native.json`),
  ),
);
if (
  varuint.build !== native.build ||
  varuint.protocol !== native.protocol ||
  varuint.decoderImageSha256 !== native.decoderImageSha256 ||
  varuint.kind !== "original-target-base-flags-varuint-boundaries" ||
  varuint.scope.maximumEightByteConsumptionVerified !== true
)
  throw Error("Matching original varuint boundary observations required");
for (const [path, hash] of Object.entries(varuint.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error(`Varuint native input changed: ${path}`);
for (const [name, hash] of Object.entries(varuint.sources))
  if ((await sha256(await raw(resolve(import.meta.dir, name)))) !== hash)
    throw Error(`Varuint native producer changed: ${name}`);
for (const block of varuint.blocks)
  if (
    (await sha256(image.subarray(block.rva, block.rva + block.bytes))) !==
    block.sha256
  )
    throw Error("Original varuint reader or registration differs");
for (const [index, control] of varuint.controls.entries()) {
  const result = readPresentationBaseFlags({
    groups: [{ group: 4, mask: 1, dataHex: control.dataHex }],
  });
  if (
    result.value !== control.value ||
    result.consumedPrefixBytes !== control.consumed
  )
    mismatches.push({ stage: "varuint", index, result, control });
}
for (const [index, control] of native.controls.entries()) {
  const result = queryConstructorViewTargetPredicate(
    Boolean(control.suppliedInitializedByte201),
    control.suppliedBaseFlagsC50,
  );
  if (result !== Boolean(control.originalTargetPredicate))
    mismatches.push({ index, result, control });
}
const report = {
  schema: 1,
  build: native.build,
  protocol: native.protocol,
  kind: "presentation-constructor-view-target-comparison",
  inputs,
  controls: native.controls.length,
  constructorBaseFlags: native.preconditions.baseFlagsC50,
  radiusVirtualTables: native.radiusVirtualTables.length,
  originalVaruintBoundaryControls: varuint.controls.length,
  mismatches,
  assumptions: PRESENTATION_TARGET_ASSUMPTIONS,
  omissions: PRESENTATION_TARGET_OMISSIONS,
  scope: {
    originalTargetPredicateExecuted: true,
    suppliedConstructorBranchInputs: true,
    actualNativeTargetAcceptanceRecovered: false,
    actualMotionAdmissionChanged: false,
  },
};
const output = `${cache}/research/presentation-targets-comparison.json`;
await Bun.write(output, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    output,
    controls: report.controls,
    mismatches: mismatches.length,
  }),
);
if (mismatches.length) process.exitCode = 1;
