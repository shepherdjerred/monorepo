import { resolve } from "node:path";
import { createLatestEffectContexts } from "../latest-effect-contexts.mjs";
import { createLatestEffectResolvers } from "../latest-effect-resolvers.mjs";
import {
  createLatestBuiltinResourceContexts,
  BUILTIN_RESOURCE_CONTEXTS_SHA,
} from "../latest-builtin-resource-contexts.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  inputs = {},
  sha = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  raw = async (path) => {
    const bytes = await Bun.file(path).bytes();
    inputs[resolve(path)] = sha(bytes);
    return bytes;
  },
  read = async (path) => JSON.parse(new TextDecoder().decode(await raw(path))),
  load = (path) => raw(`${cache}/public/${path}`),
  check = (condition, message) => {
    if (!condition) throw Error(message);
  },
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  native = await read(
    `${cache}/research/builtin-resource-contexts-native.json`,
  ),
  packageBytes = await load("latest-builtin-resource-contexts/package.json"),
  policy = await createLatestBuiltinResourceContexts({ profile, packageBytes }),
  effectsManifestBytes = await load("latest-effects/manifest.json"),
  contexts = await createLatestEffectContexts({
    profile,
    effectsManifestBytes,
    packageBytes: await load("latest-effect-contexts/package.json"),
  }),
  resolvers = await createLatestEffectResolvers({
    profile,
    contexts,
    effectsManifestBytes,
    packageBytes: await load("latest-effect-resolvers/package.json"),
    builtinContextPackageBytes: packageBytes,
  }),
  report = await read(`${cache}/research/latest-semantics-effects.json`),
  image = await load("decoder-16.21-macos/image.bin");
for (const [path, digest] of Object.entries(native.inputs))
  check(
    sha(await raw(path)) === digest,
    `Changed original built-in input: ${path}`,
  );
for (const block of native.originalBlocks)
  check(
    sha(image.subarray(block.rva, block.rva + block.size)) === block.sha256,
    "Original built-in instructions differ",
  );
check(
  native.shared.resolver === 0 && native.shared.getterRva === 0x35a270,
  "Original Shared resource getter differs",
);
check(
  policy.lookup(native.sharedIdentity)?.status ===
    "known-null-resource-resolver",
  "Shared JS/null-native comparison differs",
);
for (const control of native.missingIdentityControls)
  check(
    policy.lookup(control.identity) === null,
    "A cold-registry control was promoted to actual registry history",
  );
const counts = {},
  actualNoUnitRequests = [];
for (const d of report.effectDescriptors) {
  if (
    d.time < 69 ||
    d.time > 99 ||
    d.resourceContextEntityId ||
    d.lookupA8EntityId
  )
    continue;
  const selected = resolvers.selectAuxiliary(
    d.unresolvedAuxiliaryContextIds,
    d.resourceKey,
  );
  counts[selected.status] = (counts[selected.status] ?? 0) + 1;
  actualNoUnitRequests.push({
    creationSequence: d.creationSequence,
    time: d.time,
    transportSequence: d.transportSequence,
    resourceKey: d.resourceKey,
    contextIds: d.unresolvedAuxiliaryContextIds,
    selection: selected,
    runtimeActivated: false,
  });
}
check(
  actualNoUnitRequests.length === 62 &&
    counts["continue-global-resolution"] === 55 &&
    counts["unprepared-context-id"] === 7,
  "Actual no-unit boundary inventory changed",
);
for (const name of [
  "latest-builtin-resource-contexts.mjs",
  "latest-effect-contexts.mjs",
  "latest-effect-resolvers.mjs",
  "tools/observe-builtin-resource-contexts.py",
  "tools/prepare-builtin-resource-contexts.mjs",
  "tools/inspect-builtin-resource-contexts.mjs",
])
  await raw(`${root}/${name}`);
for (const [path, digest] of Object.entries(inputs))
  check(
    sha(await Bun.file(path).bytes()) === digest,
    `Input changed during comparison: ${path}`,
  );
const result = {
  schema: 1,
  kind: "native-js-builtin-resource-context-comparison",
  build: profile.clientVersion,
  protocol: profile.protocolDigest,
  packageSha256: BUILTIN_RESOURCE_CONTEXTS_SHA,
  nullGetterControls: 9,
  comparisonWindow: [69, 99],
  counts,
  actualNoUnitRequests,
  mismatchCount: 0,
  inputs,
  scope: {
    browserCompatibleKernelExecutedInBun: true,
    actualBrowserExecuted: false,
    actualReplayInputs: true,
    actualReplayRegistryRecovered: false,
    globalResourceMapsRecovered: false,
    runtimeActivated: 0,
    coldRegistryMissControlsAreNotActualFallbackEvidence: true,
  },
};
await Bun.write(
  `${cache}/research/builtin-resource-contexts-comparison.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    nullGetterControls: 9,
    actualNoUnitRequests: actualNoUnitRequests.length,
    counts,
    inputs: Object.keys(inputs).length,
    runtimeActivated: 0,
  }),
);
