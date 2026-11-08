// Comparison only; neither a runtime registry package nor an admission policy.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { nativeCharacterEffectContextIdentity } from "../latest-effect-contexts.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
const raw = async (path) => {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Input changed: ${path}`);
  inputs[path] = hash;
  return bytes;
};
const native = JSON.parse(
  new TextDecoder().decode(
    await raw(`${cache}/research/health-relic-effect-context-native.json`),
  ),
);
if (
  native.kind !== "original-health-relic-context-identity-control" ||
  native.build !== "16.21.829.8620" ||
  native.protocol !== "20e09df23c66b85e" ||
  native.scope.actualReplayRegistryPublicationRecovered ||
  native.scope.loadedResourceGetterEstablished ||
  native.scope.assetLoadingExecuted
)
  throw Error("Original bounded HealthRelic context proof required");
for (const [path, hash] of Object.entries(native.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error(`Stale native context input: ${path}`);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
if ((await sha256(image)) !== native.decoderImageSha256)
  throw Error("Original context image differs");
for (const block of native.sourceBlocks)
  if (
    (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
    block.sha256
  )
    throw Error("Original context instructions differ");
const cases = [native.context, ...native.skinBoundaryControls];
for (const row of cases)
  if (
    nativeCharacterEffectContextIdentity(
      row.name,
      row.skinId,
      row.namespace,
    ) !== row.identity
  )
    throw Error("Shared browser identity differs from original constructor");
if (
  native.context.identity !== 3143740604 ||
  native.registry.resourceGetterRva !== 0x353f70 ||
  !native.registry.constructorPrefixNullGetterControl ||
  native.recordedRequests.providerFreeComparisonWindow !== 7
)
  throw Error("Recorded identity/getter/control scope differs");
const { authoredResourceKeys, absentRequestedKeys } = native.installedInputs;
if (absentRequestedKeys.some((key) => authoredResourceKeys.includes(key)))
  throw Error(
    "Map-global request unexpectedly belongs to authored HealthRelic skin",
  );
for (const path of [
  import.meta.path,
  resolve(import.meta.dir, "../latest-effect-contexts.mjs"),
  resolve(import.meta.dir, "../structural-comparison.mjs"),
])
  await raw(path);
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error(`Input drift: ${path}`);
const result = {
  schema: 1,
  kind: "health-relic-context-identity-comparison",
  inputs,
  cases: cases.length,
  mismatches: [],
  identity: native.context.identity,
  resourceGetterRva: native.registry.resourceGetterRva,
  installedInputs: native.installedInputs,
  recordedRequests: native.recordedRequests,
  omissions: [
    "resource:actual-character-preload-and-registry-publication-unrecovered",
    "resource:loaded-context-getter-and-asset-readiness-unrecovered",
    "resource:actual-first-global-overlays-and-registration-history-unrecovered",
    "resource:map-global-vfx-reference-linking-and-activation-unrecovered",
  ],
  scope: {
    staticIdentityAndAuthoredKeys: true,
    originalSuppliedRegistryControl: true,
    runtimeAdmissionChanged: false,
    actualRegistryAccepted: false,
    renderedCoverage: false,
    browserPlayback: false,
  },
};
const output = `${cache}/research/health-relic-context-comparison.json`;
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    cases: cases.length,
    providerFreeRequests: native.recordedRequests.providerFreeComparisonWindow,
    inputFingerprintsVerified: Object.keys(inputs).length,
    mismatches: 0,
  }),
);
