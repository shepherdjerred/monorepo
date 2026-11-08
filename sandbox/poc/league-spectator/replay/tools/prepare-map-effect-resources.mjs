// Build-only map lookup/global precedence contract from original native code.
import { resolve } from "node:path";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  raw = (p) => Bun.file(p).bytes(),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  inputBytes = await raw(`${assets}/latest-map-effect-inputs/package.json`),
  input = JSON.parse(new TextDecoder().decode(inputBytes)),
  bytes = await raw(`${cache}/research/map-effect-resources-native.json`),
  native = JSON.parse(new TextDecoder().decode(bytes)),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`);
if (
  native.kind !== "native-map-effect-resource-observations" ||
  native.packageSha256 !== sha(inputBytes) ||
  native.decoderImageSha256 !== sha(image) ||
  native.build !== input.build ||
  native.protocol !== input.protocol ||
  native.counts.maps !== Object.keys(input.resolvers).length ||
  native.counts.rows !== 505 ||
  native.counts.merges !== 15 ||
  native.counts.globalWorlds !== 5 ||
  native.counts.globalQueries !== 2550 ||
  !native.scope.originalTypedMapReaders ||
  !native.scope.originalStableMapMerge ||
  !native.scope.completeOriginalGlobalResolver ||
  !native.scope.suppliedGlobalStacks ||
  !native.scope.mapValuesAreReferenceTokens ||
  native.scope.activeMapVariantRecovered ||
  native.scope.activeGuestRecovered ||
  native.scope.externalLinksResolved ||
  native.scope.worldFactoryExecuted
)
  throw Error("Complete original map/global resolver observation required");
for (const [name, digest] of Object.entries(native.sources))
  if (sha(await raw(`${root}/tools/${name}`)) !== digest)
    throw Error(`Changed map resource producer: ${name}`);
for (const [path, digest] of Object.entries(native.inputs))
  if (sha(await raw(path)) !== digest)
    throw Error("Changed map resource native input");
for (const b of native.originalBlocks)
  if (sha(image.subarray(b.rva, b.rva + b.size)) !== b.sha256)
    throw Error("Changed original map resource instructions");
const maps = Object.fromEntries(
  native.maps.map((m) => {
    const rows = m.rows.map(({ key, value }) => ({
        key,
        referenceToken: value,
      })),
      expected = input.resolvers[m.id].rows.map(({ key, reference }) => ({
        key,
        referenceToken: parseInt(reference, 16),
      }));
    if (JSON.stringify(rows) !== JSON.stringify(expected))
      throw Error("Authored/native map row identity differs");
    return [m.id, { rows }];
  }),
);
const result = {
  schema: 1,
  kind: "prepared-map-effect-resource-contract",
  build: native.build,
  protocol: native.protocol,
  decoderImageSha256: sha(image),
  inputsPackageSha256: sha(inputBytes),
  observationSha256: sha(bytes),
  preparerSha256: sha(await raw(import.meta.path)),
  mapId: input.mapId,
  maps,
  mapSkins: input.mapSkins,
  guests: input.guests,
  definitions: input.definitions,
  definitionIndex: input.definitionIndex,
  entries: {
    lookup: 0x16153d0,
    constructor: 0x16659b0,
    merge: 0x16154a0,
    globalResolve: 0x377890,
    register: 0x1615ae0,
    unregister: 0x16159a0,
    publishGlobal: 0x3783b0,
  },
  merge: "append-then-stable-sort-by-unsigned-key-keeping-duplicates",
  lookup: "first-equal-key-in-sorted-array-including-null",
  globalOrder: [
    "first-global-overlays-reversed",
    "first-global-base",
    "second-global-overlays-reversed",
    "second-global-base",
    "registered-maps-forward",
  ],
  sourceBlocks: native.originalBlocks,
  scope: {
    staticBuildDataOnly: true,
    containsReplayEvents: false,
    containsUnitInstances: false,
    originalTypedMapsAndStableMergesObserved: true,
    completeGlobalResolverObserved: true,
    suppliedGlobalStacks: true,
    resolverValuesAreReferenceTokens: true,
    activeMapVariantRecovered: false,
    activeGuestRecovered: false,
    externalLinksResolved: false,
    completeFactoryPrecedenceVerified: false,
    worldFactoryExecuted: false,
    browserExecuted: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${assets}/latest-map-effect-resources/package.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    sha256: sha(
      await raw(`${assets}/latest-map-effect-resources/package.json`),
    ),
    maps: Object.keys(maps).length,
    rows: Object.values(maps).reduce((n, m) => n + m.rows.length, 0),
  }),
);
