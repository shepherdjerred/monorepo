// Prepares immutable program/proof metadata only. No replay events, unit IDs,
// handles, registry instances or per-match selected resources enter the package.
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { EFFECT_CONTEXTS_PACKAGE_SHA } from "../latest-effect-contexts.mjs";
import { EFFECT_RESOLVERS_PACKAGE_SHA } from "../latest-effect-resolvers.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Input changed: ${path}`);
  inputs[path] = digest;
  return bytes;
}
async function read(path) {
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)),
  );
}
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
if (
  profile.clientVersion !== "16.21.829.8620" ||
  profile.protocolDigest !== "20e09df23c66b85e" ||
  profile.decoderImageSha256 !== (await sha256(image))
)
  throw Error("Exact original initial resource program required");
const proofNames = [
  "initial-hero-resource-arguments-native",
  "initial-resource-prefix-native",
  "character-context-resources-native",
];
const proofs = [];
const blocks = new Map();
const programBlocks = new Map();
for (const name of proofNames) {
  const path = `${cache}/research/${name}.json`,
    proof = await read(path);
  if (
    proof.build !== profile.clientVersion ||
    proof.protocol !== profile.protocolDigest ||
    proof.decoderImageSha256 !== profile.decoderImageSha256
  )
    throw Error("Matching original prefix proofs required");
  for (const [path, digest] of Object.entries(proof.inputs))
    if ((await sha256(await raw(path))) !== digest)
      throw Error(`Stale prefix proof input: ${path}`);
  for (const row of [
    ...proof.originalBlocks,
    ...(proof.staticBlocks ?? []),
    ...(proof.sourceBlocks ?? []),
  ]) {
    const rva = row.rva ?? row.startRva,
      size = row.size ?? row.endRva - row.startRva;
    if (
      !Number.isInteger(rva) ||
      !Number.isInteger(size) ||
      rva < 0 ||
      size <= 0 ||
      rva + size > image.length ||
      (await sha256(image.subarray(rva, rva + size))) !== row.sha256
    )
      throw Error("Original prefix instruction block differs");
    blocks.set(`${rva}:${size}`, { rva, size, sha256: row.sha256 });
  }
  for (const row of [
    ...(proof.staticBlocks ?? []),
    ...(proof.sourceBlocks ?? []),
  ]) {
    const rva = row.rva ?? row.startRva,
      size = row.size ?? row.endRva - row.startRva;
    programBlocks.set(`${rva}:${size}`, { rva, size, sha256: row.sha256 });
  }
  proofs.push({ name, path, digest: inputs[resolve(path)], value: proof });
}
const [argument, prefix, binding] = proofs.map((row) => row.value);
if (
  argument.kind !== "original-initial-hero-resource-arguments" ||
  !argument.scope.actualTenInitialPacketArgumentFragments ||
  argument.scope.fullHeroFactoryExecuted ||
  argument.scope.actualInitialResourceStackRecovered ||
  argument.scope.nativeWorldAcceptance !== null ||
  argument.cases.length !== 10 ||
  prefix.kind !== "original-initial-default-resource-prefix-control" ||
  !prefix.scope.originalAiConstructorsExecuted ||
  !prefix.scope.originalDefaultSetterExecuted ||
  !prefix.scope.originalPreVisualBaseCallbackExecuted ||
  !prefix.scope.suppliedPreparedCache ||
  !prefix.scope.suppliedTypedAuthoredResolvers ||
  prefix.scope.fullCharacterAssetLoaderExecuted ||
  prefix.scope.appearanceReadinessEstablished ||
  prefix.scope.acceptedReplayState ||
  prefix.scope.networkAdmissionEstablished ||
  prefix.cases.length !== 10 ||
  binding.kind !== "original-character-context-resource-controls" ||
  !binding.scope.originalTypedInstalledResolverReader ||
  !binding.scope.originalLoadedGetterAndSuppliedPublication ||
  binding.scope.actualStartupRegistryPublicationRecovered ||
  binding.scope.assetReadinessRecovered ||
  binding.scope.vfxReferenceTokensLinked
)
  throw Error(
    "Bounded original initial arguments/default/binding proof scope required",
  );
const flags = [true, false, true, true, true];
const seen = new Set();
for (const row of prefix.cases) {
  const key = row.stored.defaultEntry.key;
  const identity = `${row.champion}:${row.skinId}`;
  if (
    seen.has(identity) ||
    argument.cases.filter(
      (v) => v.character === row.champion && v.skinId === row.skinId,
    ).length !== 1 ||
    key.name !== row.champion ||
    key.skinId !== row.skinId ||
    key.namespace !== "" ||
    key.keyFlags !== 0 ||
    JSON.stringify(row.stored.defaultEntry.flags) !== JSON.stringify(flags) ||
    row.stored.entries.length ||
    row.initial.context !== 0 ||
    row.initial.baseResolver !== 0 ||
    row.initial.overlays.length ||
    row.installed.overlays.length ||
    !row.baseCallbackWrapper ||
    row.visualCallbackWrapper !== 0 ||
    row.stoppedRva !== 0x66989
  )
    throw Error(
      "Original constructor/default/base-before-visual controls differ",
    );
  seen.add(identity);
}
if (
  prefix.counts.originalAiConstructors !== 10 ||
  prefix.counts.defaultStoragePrefixes !== 10 ||
  prefix.counts.baseCallbacksBeforeVisualCallbacks !== 10 ||
  prefix.counts.emptyOverlayStates !== 10
)
  throw Error("Complete independent prefix control counts required");
const typed = binding.bindings.find((row) => row.label === "typed-resolver");
if (
  !typed?.accepted ||
  typed.getterRva !== 0x353f70 ||
  !typed.loadAttemptCompleted ||
  typed.typeHash !== 0xef3a0f33
)
  throw Error("Original typed context getter binding required");
for (const [rva, end] of [
  [0x351af4, 0x351b46],
  [0x352741, 0x352767],
  [0x353f70, 0x353f80],
  [0x3526a6, 0x35271f],
])
  programBlocks.set(`${rva}:${end - rva}`, {
    rva,
    size: end - rva,
    sha256: await sha256(image.subarray(rva, end)),
  });
for (const [path, digest] of [
  ["latest-effect-contexts/package.json", EFFECT_CONTEXTS_PACKAGE_SHA],
  ["latest-effect-resolvers/package.json", EFFECT_RESOLVERS_PACKAGE_SHA],
])
  if ((await sha256(await raw(`${cache}/public/${path}`))) !== digest)
    throw Error("Pinned static context/resolver package required");
for (const path of [
  import.meta.path,
  "../latest-effect-contexts.mjs",
  "../latest-effect-resolvers.mjs",
  "../structural-comparison.mjs",
])
  await raw(path.startsWith("..") ? resolve(import.meta.dir, path) : path);
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error(`Input drift: ${path}`);
const program = {
  schema: 1,
  kind: "prepared-initial-resource-presentation-prefix",
  policy: "native-initial-resource-presentation-prefix-v1",
  build: profile.clientVersion,
  protocol: profile.protocolDigest,
  decoderImageSha256: profile.decoderImageSha256,
  contextsPackageSha256: EFFECT_CONTEXTS_PACKAGE_SHA,
  resolversPackageSha256: EFFECT_RESOLVERS_PACKAGE_SHA,
  initialPacket: {
    opcode: 1049,
    stream: 2,
    time: 0,
    name: "decoded-character",
    skinId: "decoded-skin",
  },
  defaultEntry: {
    namespace: "",
    keyFlags: 0,
    flags,
    modifierNames: [],
    alternateCharacterA: "",
    alternateCharacterB: "",
    entries: [],
    overlays: [],
  },
  baseCallback: {
    projectionOutputIndex: 5,
    wrapperRva: 0xc4f10,
    unitContextSetterRva: 0x548bf0,
    resolverGetterRva: 0x353f70,
    stopRva: 0x66989,
    nextVisualCallbackRva: 0x669bc,
  },
  invalidation:
    "first-subsequent-unimplemented-owner-resource-or-appearance-request",
  originalBlocks: [...programBlocks.values()].sort(
    (a, b) => a.rva - b.rva || a.size - b.size,
  ),
  verifiedNativeObservationBlocks: blocks.size,
  proofArtifacts: proofs.map(({ name, digest }) => ({
    name,
    sha256: digest,
    comparisonOnly: true,
  })),
  inputs,
  omissions: [
    "resource:explicit-browser-static-asset-policy-for-native-cache-acquisition",
    "resource:native-loader-readiness-and-complete-appearance-callback-unrecovered",
    "resource:actual-engine-world-admission-and-native-presentation-handles-unknown",
    "resource:all-unimplemented-subsequent-owner-mutations-invalidate-this-prefix",
    "resource:later-snapshot-restore-and-dynamic-script-overlay-history-unrecovered",
  ],
  scope: {
    staticBuildDataOnly: true,
    containsReplayEvents: false,
    containsUnitInstances: false,
    original1049ArgumentBridge: true,
    defaultStoragePrefix: true,
    baseCallbackPrefix: true,
    constructorEmptyOverlays: true,
    suppliedPreparedNativeCacheControls: true,
    browserStaticAssetContractRequired: true,
    nativeCacheAcquisitionRecovered: false,
    assetReadinessRecovered: false,
    nativeWorldAcceptanceRecovered: false,
    fullAppearanceCallbackRecovered: false,
    completeMatchFidelityEstablished: false,
  },
};
const directory = `${cache}/public/latest-initial-resource-prefix`;
await mkdir(directory, { recursive: true });
const output = `${directory}/package.json`;
const encoded = new TextEncoder().encode(JSON.stringify(program, null, 2));
await Bun.write(output, encoded);
console.log(
  JSON.stringify({
    output,
    sha256: await sha256(encoded),
    originalBlocks: program.originalBlocks.length,
    inputFingerprintsVerified: Object.keys(inputs).length,
    replayEvents: 0,
    unitInstances: 0,
  }),
);
