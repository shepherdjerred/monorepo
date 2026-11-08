// Build-only character/skin context keys recovered from the original constructor.
import { resolve } from "node:path";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  assets = `${cache}/public`,
  root = resolve(import.meta.dir, ".."),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => Bun.file(p).bytes(),
  nativeBytes = await raw(`${cache}/research/effect-contexts-native.json`),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  manifestBytes = await raw(`${assets}/latest-effects/manifest.json`),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes)),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`);
if (
  native.effectsManifestSha256 !== sha(manifestBytes) ||
  native.decoderImageSha256 !== sha(image) ||
  native.build !== manifest.build ||
  native.protocol !== manifest.protocol ||
  !native.scope.originalRegistryInsertionAndLookup ||
  native.scope.assetLoadingExecuted
)
  throw Error("Native character context inputs differ");
for (const [name, digest] of Object.entries(native.sources))
  if (sha(await raw(`${root}/tools/${name}`)) !== digest)
    throw Error(`Context native source changed: ${name}`);
for (const b of native.originalBlocks)
  if (sha(image.subarray(b.rva, b.rva + b.size)) !== b.sha256)
    throw Error("Context native instructions changed");
const contexts = native.contexts.map((c) => {
  const actor = manifest.actors[c.actorKey];
  if (
    !actor ||
    actor.character !== c.name ||
    actor.skinId !== c.skinId ||
    c.namespace !== "characters"
  )
    throw Error("Context native character/skin differs");
  return {
    actorKey: c.actorKey,
    name: c.name,
    skinId: c.skinId,
    namespace: c.namespace,
    identity: c.identity,
    resourceResolverId: actor.resourceResolverId,
  };
});
if (
  new Set(contexts.map((c) => c.identity)).size !== contexts.length ||
  contexts.length !== Object.keys(manifest.actors).length
)
  throw Error("Incomplete/ambiguous static character contexts");
const result = {
  schema: 1,
  kind: "prepared-character-effect-contexts",
  build: native.build,
  protocol: native.protocol,
  decoderImageSha256: native.decoderImageSha256,
  effectsManifestSha256: sha(manifestBytes),
  observationSha256: sha(nativeBytes),
  identity: {
    seedText: "[Character]",
    multiplier: 0x1003f,
    order: ["name", "skinUnsignedDecimal", "namespace"],
    hashRva: 0x1442120,
    appendRva: 0x14371c0,
    constructorPrefix: [0x351910, 0x3519e7],
    identityFragment: [0x351af4, 0x351b46],
    registryLookupRva: 0x354280,
  },
  contexts,
  sourceBlocks: native.originalBlocks,
  preparerSha256: sha(await raw(import.meta.path)),
  scope: {
    staticBuildDataOnly: true,
    containsReplayEvents: false,
    originalIdentityAndRegistryObserved: true,
    nativeDecimalFormatterExecuted: false,
    staticAssetLoaderExecuted: false,
    fullResourcePrecedenceVerified: false,
    fullMatchRegistryReconstructed: false,
  },
};
const encoded = JSON.stringify(result, null, 2);
await Bun.write(`${assets}/latest-effect-contexts/package.json`, encoded);
console.log(
  JSON.stringify({ sha256: sha(encoded), contexts: contexts.length }),
);
