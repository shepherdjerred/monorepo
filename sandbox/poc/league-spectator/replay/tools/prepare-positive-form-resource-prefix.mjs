// Static capability preparation. Recorded requests remain browser replay inputs.
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { sha256 } from "../structural-comparison.mjs";
import { UNIT_GEAR_RESOURCES_SHA } from "../latest-unit-gear-resources.mjs";

const [cacheArgument = ".cache/replay-spike", ...actorKeys] =
  process.argv.slice(2);
if (!actorKeys.length || new Set(actorKeys).size !== actorKeys.length)
  throw Error(
    "Usage: bun prepare-positive-form-resource-prefix.mjs <cache> <actor-key> [...actor-keys]",
  );
const cache = resolve(cacheArgument),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Changed positive-prefix input: ${path}`);
  inputs[path] = digest;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)));
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`),
  manifestBytes = await raw(`${cache}/public/latest-effects/manifest.json`),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes)),
  gearBytes = await raw(
    `${cache}/public/latest-unit-gear-resources/package.json`,
  ),
  gearTable = JSON.parse(new TextDecoder().decode(gearBytes));
if (
  profile.clientVersion !== "16.21.829.8620" ||
  profile.protocolDigest !== "20e09df23c66b85e" ||
  (await sha256(image)) !== profile.decoderImageSha256 ||
  (await sha256(gearBytes)) !== UNIT_GEAR_RESOURCES_SHA
)
  throw Error("Exact positive-prefix image and original gear package required");
const capabilities = [],
  sourceBlocks = new Map();
for (const actorKey of actorKeys) {
  const actor = manifest.actors[actorKey],
    gears = gearTable.actors[actorKey];
  if (!actor || !gears)
    throw Error(`Owned static actor/gear table missing: ${actorKey}`);
  const proofPath = `${cache}/research/positive-form-resource-${actorKey.replaceAll("/", "-")}-native.json`,
    proof = await read(proofPath),
    scope = proof.scope;
  if (
    proof.actorKey !== actorKey ||
    proof.build !== profile.clientVersion ||
    proof.protocol !== profile.protocolDigest ||
    proof.decoderImageSha256 !== profile.decoderImageSha256 ||
    !scope.actualInstalledGearTableLoadedAndLinked ||
    !scope.originalLazyProducerExecuted ||
    !scope.resourcePrefixThroughSelectedPushExecuted ||
    scope.completeOpcode129Executed !== false ||
    scope.nativeReplayAcceptance !== null ||
    !proof.fullListenerBoundary ||
    proof.boundary !== null ||
    !proof.controls.length
  )
    throw Error(
      "Original installed resource publication prefix proof required",
    );
  for (const [path, digest] of Object.entries({
    ...proof.inputs,
    ...proof.sources,
  }))
    if ((await sha256(await raw(path))) !== digest)
      throw Error(`Stale original positive-prefix proof: ${path}`);
  for (const block of proof.originalBlocks) {
    if (
      !Number.isSafeInteger(block.rva) ||
      !Number.isSafeInteger(block.size) ||
      block.rva < 0 ||
      block.size <= 0 ||
      block.rva + block.size > image.length ||
      (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
        block.sha256
    )
      throw Error("Original positive-prefix instructions changed");
    if (
      [
        [0xbf8b0, 0xbf980],
        [0xfdd00, 0xfde02],
        [0x30d220, 0x30d670],
        [0x30ed00, 0x30f11a],
        [0x377380, 0x377500],
        [0x548bf0, 0x548c90],
      ].some(([start, end]) => block.rva >= start && block.rva < end)
    )
      sourceBlocks.set(`${block.rva}:${block.size}`, block);
  }
  const indices = [...new Set(proof.controls.map((row) => row.index))].sort(
      (a, b) => a - b,
    ),
    selections = [];
  for (const index of indices) {
    const controls = proof.controls.filter((row) => row.index === index),
      gear = gears[index];
    if (
      !gear ||
      !gear.resolverPresent ||
      controls.some(
        (row) =>
          row.selectedIndex !== index ||
          row.after.length !== 1 ||
          row.visits.at(-1) !== 0x377390,
      ) ||
      ![false, true].every((flag) =>
        controls.some((row) => row.nativeFlag === flag),
      )
    )
      throw Error(
        "Both original flag branches and one published resolver required",
      );
    selections.push({
      index,
      gearIdentity: gear.gearIdentity,
      sourceSha256: gear.sourceSha256,
      rows: structuredClone(gear.rows),
    });
  }
  const negative = proof.fullListenerControls.filter(
    (row) => row.index === 255 && row.nativeFlag === false,
  );
  if (
    negative.length !== 1 ||
    JSON.stringify(negative[0].before) !== JSON.stringify(negative[0].after)
  )
    throw Error(
      "Complete negative listener must preserve exact resource identity",
    );
  capabilities.push({
    actorKey,
    character: actor.character,
    skinId: actor.skinId,
    skinPath: actor.skinPath,
    nativeProofSha256: inputs[resolve(proofPath)],
    selections,
    negativeRequestPreservesResourceIdentity: true,
    originalPublicationBoundaryRva: 0x30f11a,
    downstreamBoundary: structuredClone(proof.fullListenerBoundary),
  });
}
const metadata = {
  schema: 1,
  kind: "prepared-positive-form-resource-prefix",
  policy: "native-positive-form-resource-prefix-v1",
  build: profile.clientVersion,
  protocol: profile.protocolDigest,
  decoderImageSha256: profile.decoderImageSha256,
  effectsManifestSha256: await sha256(manifestBytes),
  unitGearResourcesSha256: UNIT_GEAR_RESOURCES_SHA,
  capabilities,
  sourceBlocks: [...sourceBlocks.values()],
  scope: {
    staticBuildDataOnly: true,
    containsReplayEvents: false,
    containsUnitInstances: false,
    originalResourcePublicationBeforeModelReadiness: true,
    completePositiveListener: false,
    nativeReplayAcceptance: null,
    snapshotRestorationRecovered: false,
    nativeSnapshotAcceptance: null,
    selectedResourcePrefixOnly: true,
    olderUnknownStackFallbackAllowed: false,
  },
  omissions: [
    "form:native-model-table-and-render-readiness-unrecovered",
    "form:downstream-pose-submesh-material-callbacks-not-replayed",
    "form:native-live-unit-request-acceptance-unrecovered",
    "form:snapshot-restoration-unimplemented-native-acceptance-unknown",
  ],
};
const out = `${cache}/public/latest-positive-form-resource-prefix/package.json`,
  bytes = new TextEncoder().encode(JSON.stringify(metadata, null, 2));
await mkdir(resolve(out, ".."), { recursive: true });
await Bun.write(out, bytes);
await raw(import.meta.path);
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error(`Positive-prefix input changed before publication: ${path}`);
const report = {
  schema: 1,
  kind: "positive-form-resource-prefix-static-preparation",
  packageSha256: await sha256(bytes),
  inputs,
  capabilities: capabilities.map(({ actorKey, selections }) => ({
    actorKey,
    indices: selections.map(({ index }) => index),
  })),
  originalBlocksValidated: sourceBlocks.size,
  scope: metadata.scope,
};
await Bun.write(
  `${cache}/research/positive-form-resource-prefix-preparation-v35.json`,
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    out,
    sha256: report.packageSha256,
    capabilities: report.capabilities,
  }),
);
