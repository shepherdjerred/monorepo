// Build-specific original descriptor factory; no match requests are exported.
import { resolve } from "node:path";
import { WORLD_EFFECT_ABI_SHA } from "../latest-world-effect-abi.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  raw = (p) => Bun.file(p).bytes(),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  bytes = await raw(`${cache}/research/world-descriptors-native.json`),
  n = JSON.parse(new TextDecoder().decode(bytes)),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`),
  profile = await Bun.file(`${assets}/decoder-16.21-macos/profile.json`).json();
if (
  n.kind !== "native-world-descriptor-factory-observations" ||
  n.counts.roots !== 10 ||
  n.counts.returningRoots !== 10 ||
  n.counts.frames !== 120 ||
  n.counts.restoredFrames !== 60 ||
  n.scope.partialActorSelection ||
  !n.scope.completeOriginalDescriptorFactory ||
  !n.scope.explicitDetachedDescriptors ||
  !n.scope.suppliedSingleDefinitionResolver ||
  n.scope.decodedReplayRequestsExecuted ||
  n.scope.entityBoneAttachments ||
  n.scope.replayWorldStateRecovered ||
  n.decoderImageSha256 !== sha(image) ||
  n.build !== profile.clientVersion ||
  n.protocol !== profile.protocolDigest ||
  sha(await raw(`${assets}/latest-world-effect-abi/package.json`)) !==
    WORLD_EFFECT_ABI_SHA
)
  throw Error(
    "Complete matching detached descriptor factory evidence required",
  );
for (const [path, digest] of Object.entries(n.inputs))
  if (sha(await raw(path)) !== digest)
    throw Error("Descriptor factory input changed");
for (const [name, digest] of Object.entries(n.sources))
  if (sha(await raw(`${root}/tools/${name}`)) !== digest)
    throw Error(`Descriptor factory producer changed: ${name}`);
for (const b of n.originalBlocks)
  if (sha(image.subarray(b.rva, b.rva + b.size)) !== b.sha256)
    throw Error("Original descriptor factory instructions changed");
const result = {
  schema: 1,
  kind: "prepared-detached-world-descriptor-abi",
  build: n.build,
  protocol: n.protocol,
  decoderImageSha256: sha(image),
  worldHelperAbiSha256: WORLD_EFFECT_ABI_SHA,
  effectsManifestSha256: sha(
    await raw(`${assets}/latest-effects/manifest.json`),
  ),
  observationSha256: sha(bytes),
  preparerSha256: sha(await raw(import.meta.path)),
  supportedRoots: n.cases.map((c) => c.effectId),
  entries: { visibility: 0x624060, factory: 0x83ddc0, string: 0x11fe0 },
  context: {
    constructor: [0x351910, 0x3519e7],
    identity: [0x351af4, 0x351b46],
    text: 0x100ed000,
    strings: 0x100ed400,
    frame: 0x100ed800,
  },
  globals: { visibility: 0x24705d0 },
  inputs: {
    descriptor: 0x100ec000,
    auxiliaries: 0x100ec100,
    output: 0x100ec200,
  },
  sharedImports: {
    lock: { rva: 0x1fee4ec, symbol: "__ZNSt3__119__shared_weak_count4lockEv" },
    releaseWeak: {
      rva: 0x1fee4e6,
      symbol: "__ZNSt3__119__shared_weak_count14__release_weakEv",
    },
    maximumOwners: 65536,
  },
  sourceBlocks: n.originalBlocks,
  scope: {
    staticBuildDataOnly: true,
    containsReplayEvents: false,
    completeOriginalDescriptorFactory: true,
    originalContextConstructionAndIdentity: true,
    explicitDetachedDescriptors: true,
    suppliedSingleDefinitionResolver: true,
    suppliedClockSeedAndPosition: true,
    decodedReplayRequestsExecuted: false,
    entityBoneAttachments: false,
    replayWorldStateRecovered: false,
    standardSharedOwnershipImportsModeled: true,
    browserExecuted: false,
    referenceCompared: false,
  },
};
const encoded = JSON.stringify(result, null, 2);
await Bun.write(`${assets}/latest-world-descriptor-abi/package.json`, encoded);
console.log(
  JSON.stringify({ sha256: sha(encoded), roots: result.supportedRoots.length }),
);
