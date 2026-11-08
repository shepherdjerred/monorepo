import { resolve } from "node:path";
import {
  createLatestRootAttachmentProviderKernels,
  ROOT_ATTACHMENT_PROVIDER_PROOF,
  HERO_ROOT_SELECTION_PROOF,
} from "../latest-root-attachment-provider.mjs";
import { sha256 } from "../structural-comparison.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const root = resolve(import.meta.dir, "..");
const inputs = {};
async function raw(path) {
  const data = await Bun.file(path).bytes();
  inputs[resolve(path)] = await sha256(data);
  return data;
}
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const native = await read(
  `${cache}/research/root-attachment-provider-native.json`,
);
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
const kernel = createLatestRootAttachmentProviderKernels(profile);
const hero = await read(`${cache}/research/hero-root-attachment-native.json`);
if (
  native.schema !== 1 ||
  native.kind !== "original-root-attachment-provider-leaf-controls" ||
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest ||
  native.decoderImageSha256 !== (await sha256(image)) ||
  !native.scope.originalAiBaseConstructorAndOwnership ||
  !native.scope.suppliedAnimationComponentOwnerFieldView ||
  !native.scope.originalKeyZeroPositionLeafExecuted ||
  !native.scope.originalWrapperFlagSetterExecuted ||
  !native.scope.originalSourceMatrixPredicateExecuted ||
  native.scope.concreteHeroRootPositionEstablished ||
  native.scope.matchAttachmentsResolved ||
  native.positionCases.length !== 4 ||
  native.flagCases.length !== 64
)
  throw Error("Bounded original root-provider control contract differs");
for (const [path, digest] of Object.entries({
  ...native.inputs,
  ...native.sources,
}))
  if ((await sha256(await raw(path))) !== digest)
    throw Error(`Stale native root-provider input: ${path}`);
for (const [path, digest] of Object.entries({
  ...hero.inputs,
  ...hero.sources,
}))
  if ((await sha256(await raw(path))) !== digest)
    throw Error(`Stale native Hero root-provider input: ${path}`);
if (
  hero.build !== profile.clientVersion ||
  hero.protocol !== profile.protocolDigest ||
  hero.decoderImageSha256 !== profile.decoderImageSha256 ||
  hero.cases.length !== 3 ||
  !hero.scope.fullOriginalConcreteHeroConstructor ||
  !hero.scope.originalSourceProviderFactory ||
  !hero.scope.coldAnimationComponentMissing ||
  hero.initial.component !== 0 ||
  hero.initial.proxyNetworkId !== 0
)
  throw Error("Bounded original cold Hero root contract differs");
for (const block of [
  HERO_ROOT_SELECTION_PROOF.rootGetter,
  HERO_ROOT_SELECTION_PROOF.proxyLookup,
])
  if (
    (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
      block.sha256 ||
    !hero.sourceBlocks.some(
      (p) =>
        p.rva === block.rva &&
        p.size === block.size &&
        p.sha256 === block.sha256,
    )
  )
    throw Error("Original Hero root-selection instructions changed");
for (const block of native.sourceBlocks)
  if (
    (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
    block.sha256
  )
    throw Error("Original root-provider instructions changed");
for (const block of ROOT_ATTACHMENT_PROVIDER_PROOF.blocks)
  if (
    !native.sourceBlocks.some(
      (p) =>
        p.rva === block.rva &&
        p.size === block.size &&
        p.sha256 === block.sha256,
    )
  )
    throw Error("Translated root-provider instruction pin differs");
for (const path of [
  "latest-root-attachment-provider.mjs",
  "latest-root-attachment-provider.test.mjs",
  "tools/inspect-root-attachment-provider.mjs",
  "structural-comparison.mjs",
])
  await raw(resolve(root, path));

for (const control of native.positionCases) {
  const result = kernel.copyRootPosition(0, control.suppliedPosition);
  const bytes = new Uint8Array(12);
  const view = new DataView(bytes.buffer);
  result.forEach((value, i) => view.setFloat32(i * 4, value, true));
  if (Buffer.from(bytes).toString("hex") !== control.outputHex)
    throw Error("Original/JS root position bits differ");
}
for (const control of native.flagCases) {
  const flags = kernel.mapWrapperFlags(
    control.wrapperFlags,
    control.initialObjectFlags,
  );
  if (
    flags !== control.objectFlags ||
    kernel.requiresSourceMatrix(flags) !== control.requiresSourceMatrix
  )
    throw Error("Original/JS source matrix predicate or object flags differ");
}
for (const control of hero.cases) {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, control.override?.[0] ?? 0, true);
  const rootSelection = {
    proxyLookup: { status: "absent" },
    overrideFirstBits:
      control.override === null ? 0x7f7fffff : view.getUint32(0, true),
    overridePosition: control.override,
    basePosition: control.position,
  };
  const selected = kernel.selectHeroRootPosition(rootSelection);
  const output = new DataView(new ArrayBuffer(12));
  selected.position.forEach((value, i) =>
    output.setFloat32(i * 4, value, true),
  );
  if (
    !selected.resolved ||
    Buffer.from(output.buffer).toString("hex") !== control.positionHex ||
    kernel.resolveRegisteredHeroRootPosition({
      entityId: 1,
      animationComponent: { status: "absent" },
      rootSelection,
    }).resolved !== control.providerPositionResolved
  )
    throw Error(
      "Original/JS cold Hero root selection or absent component differs",
    );
}
const result = {
  schema: 1,
  kind: "root-attachment-provider-leaf-comparison",
  build: profile.clientVersion,
  positionCases: native.positionCases.length,
  flagCases: native.flagCases.length,
  heroRootCases: hero.cases.length,
  differences: 0,
  inputs,
  scope: {
    exactFloat32RootPositionCopy: true,
    originalWrapperFlagMappingAndMatrixPredicate: true,
    concreteHeroColdRootSelectionEstablished: true,
    actualHeroRootInputsRecovered: false,
    providerFactorySelectionEstablished: true,
    sourceDirectionRecovered: false,
    matchAttachmentsResolved: false,
    mainViewerExpanded: false,
  },
};
const output = `${cache}/research/root-attachment-provider-comparison.json`;
await Bun.write(output, JSON.stringify(result));
console.log(
  JSON.stringify({
    output,
    positionCases: result.positionCases,
    flagCases: result.flagCases,
    differences: 0,
    fingerprints: Object.keys(inputs).length,
  }),
);
