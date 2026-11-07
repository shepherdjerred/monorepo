// Build-only unit resource precedence contract. No unit instances/replay stacks.
import { resolve } from "node:path";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = (path) => Bun.file(path).bytes(),
  observationBytes = await raw(`${cache}/research/unit-resources-native.json`),
  observation = JSON.parse(new TextDecoder().decode(observationBytes)),
  resolverBytes = await raw(`${assets}/latest-effect-resolvers/package.json`),
  resolvers = JSON.parse(new TextDecoder().decode(resolverBytes)),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`);
if (
  observation.build !== resolvers.build ||
  observation.protocol !== resolvers.protocol ||
  observation.decoderImageSha256 !== sha(image) ||
  !observation.scope.originalEntityAndComponentConstructors ||
  !observation.scope.originalComponentGetter ||
  !observation.scope.originalUnitThenAuxiliaryResolver ||
  !observation.scope.suppliedStacksNotObservedMatchState ||
  !observation.scope.mapValuesAreReferenceTokens ||
  observation.scope.globalResolutionExecuted ||
  observation.scope.worldEffectFactoryExecuted
)
  throw Error("Original unit resource precedence observation required");
for (const [name, digest] of Object.entries(observation.sources))
  if (sha(await raw(`${root}/tools/${name}`)) !== digest)
    throw Error(`Unit resource producer changed: ${name}`);
for (const [path, digest] of Object.entries(observation.inputs))
  if (sha(await raw(path)) !== digest)
    throw Error("Original unit resource input changed");
for (const block of observation.originalBlocks)
  if (sha(image.subarray(block.rva, block.rva + block.size)) !== block.sha256)
    throw Error("Original unit resource instructions changed");
const result = {
  schema: 1,
  kind: "prepared-unit-resource-precedence",
  build: observation.build,
  protocol: observation.protocol,
  decoderImageSha256: observation.decoderImageSha256,
  resolversPackageSha256: sha(resolverBytes),
  observationSha256: sha(observationBytes),
  preparerSha256: sha(await raw(import.meta.path)),
  entries: {
    entityConstructor: 0x5481e0,
    componentConstructor: 0x37f7d0,
    componentGetter: 0xd1790,
    setBase: 0x377380,
    pushOverlay: 0x377390,
    resolve: 0x377890,
    globalBoundary: 0x377a2d,
  },
  order: [
    "units-in-vector-order",
    "unit-overlays-in-reverse-order",
    "unit-base",
    "auxiliaries-in-vector-order",
  ],
  overlayPush: "remove-first-identical-handle-then-append",
  presentNullIsMatch: true,
  sourceBlocks: observation.originalBlocks,
  scope: {
    staticBuildDataOnly: true,
    containsReplayEvents: false,
    containsUnitInstances: false,
    suppliedStackAlgorithmObserved: true,
    liveMatchStacksRecovered: false,
    globalResolutionVerified: false,
    externalLinksResolved: false,
    worldEffectFactoryExecuted: false,
  },
};
const encoded = JSON.stringify(result, null, 2);
await Bun.write(`${assets}/latest-unit-resources/package.json`, encoded);
console.log(
  JSON.stringify({ sha256: sha(encoded), counts: observation.counts }),
);
