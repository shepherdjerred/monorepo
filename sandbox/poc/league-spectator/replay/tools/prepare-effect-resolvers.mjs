// Static authored maps read by the original typed ResourceResolver loader.
// Runtime pointers and replay requests stay in the research evidence only.
import { resolve } from "node:path";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = (p) => Bun.file(p).bytes(),
  bytes = await raw(`${cache}/research/effect-resolvers-native.json`),
  native = JSON.parse(new TextDecoder().decode(bytes)),
  manifestBytes = await raw(`${assets}/latest-effects/manifest.json`),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes)),
  contextBytes = await raw(`${assets}/latest-effect-contexts/package.json`),
  contexts = JSON.parse(new TextDecoder().decode(contextBytes)),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`);
if (
  native.schema !== 1 ||
  native.kind !== "native-authored-resource-resolver-observations" ||
  native.build !== manifest.build ||
  native.protocol !== manifest.protocol ||
  native.decoderImageSha256 !== sha(image) ||
  contexts.effectsManifestSha256 !== sha(manifestBytes) ||
  native.scope.partialSelection ||
  !native.scope.originalSerializedFieldReader ||
  !native.scope.originalKeyLookup ||
  !native.scope.originalAuxiliaryChainExecuted ||
  !native.scope.unitResourceContextsSuppliedEmpty ||
  !native.scope.returnedValuesAreUnresolvedAssetReferences ||
  native.scope.externalLinksResolved ||
  native.scope.completeFactoryPrecedenceExecuted
)
  throw Error("Complete original authored resolver observation required");
for (const [path, digest] of Object.entries(native.inputs))
  if (sha(await raw(path)) !== digest)
    throw Error(`Original resolver input changed: ${path}`);
for (const [name, digest] of Object.entries(native.sources))
  if (sha(await raw(`${root}/tools/${name}`)) !== digest)
    throw Error(`Original resolver producer changed: ${name}`);
for (const b of native.originalBlocks)
  if (sha(image.subarray(b.rva, b.rva + b.size)) !== b.sha256)
    throw Error("Original resolver instructions changed");
const actors = native.cases.map((c) => {
  const actor = manifest.actors[c.actorKey],
    context = contexts.contexts.find((v) => v.actorKey === c.actorKey);
  if (!actor || !context) throw Error("Resolver actor/context missing");
  const common = {
    actorKey: c.actorKey,
    contextIdentity: context.identity,
    status: c.status,
    sourceSha256: c.sourceSha256,
  };
  if (c.status === "no-authored-resource-resolver") {
    if (
      actor.resourceResolverId !== null ||
      Object.keys(actor.resources).length
    )
      throw Error("Absent authored resolver has resource entries");
    return { ...common, resourceResolverId: null, rows: [] };
  }
  if (
    c.status !== "native-resource-map-loaded" ||
    Number.parseInt(actor.resourceResolverId.replace(/[{}]/g, ""), 16) !==
      c.resourceResolverId
  )
    throw Error("Original resolver identity differs");
  const expected = Object.entries(actor.resources)
    .map(([key, v]) => ({
      key: Number.parseInt(key, 16),
      referenceToken: Number.parseInt(v.reference.replace(/[{}]/g, ""), 16),
    }))
    .sort((a, b) => a.key - b.key);
  const rows = c.loaded.rows.map(({ key, value }) => ({
    key,
    referenceToken: value,
  }));
  if (JSON.stringify(rows) !== JSON.stringify(expected))
    throw Error("Native resolver rows differ from authored manifest");
  return { ...common, resourceResolverId: c.resourceResolverId, rows };
});
if (
  actors.length !== Object.keys(manifest.actors).length ||
  new Set(actors.map((a) => a.contextIdentity)).size !== actors.length
)
  throw Error("Incomplete/ambiguous static resource resolver inventory");
const result = {
  schema: 1,
  kind: "prepared-authored-effect-resolvers",
  build: native.build,
  protocol: native.protocol,
  decoderImageSha256: native.decoderImageSha256,
  effectsManifestSha256: sha(manifestBytes),
  contextsPackageSha256: sha(contextBytes),
  observationSha256: sha(bytes),
  preparerSha256: sha(await raw(import.meta.path)),
  lookup: {
    rva: 0x16153d0,
    auxiliaryChainRva: 0x377890,
    unresolvedGlobalStageRva: 0x377a2d,
    order: "first-present-key-in-vector-order",
    nullReferenceIsPresent: true,
  },
  actors,
  sourceBlocks: native.originalBlocks,
  scope: {
    staticBuildDataOnly: true,
    containsReplayEvents: false,
    originalTypedMapsAndAuxiliaryOrderObserved: true,
    externalLinksResolved: false,
    unitResourcePrecedenceVerified: false,
    globalResolutionVerified: false,
    effectFactoryExecuted: false,
  },
};
const encoded = JSON.stringify(result, null, 2);
await Bun.write(`${assets}/latest-effect-resolvers/package.json`, encoded);
console.log(
  JSON.stringify({
    sha256: sha(encoded),
    actors: actors.length,
    rows: actors.reduce((n, a) => n + a.rows.length, 0),
  }),
);
