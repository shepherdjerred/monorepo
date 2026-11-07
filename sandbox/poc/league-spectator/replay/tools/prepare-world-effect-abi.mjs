// Exact-build world helper ABI from original native creation/frame evidence.
import { resolve } from "node:path";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  raw = (p) => Bun.file(p).bytes(),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  bytes = await raw(`${cache}/research/world-effects-native.json`),
  n = JSON.parse(new TextDecoder().decode(bytes)),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`),
  profile = await Bun.file(`${assets}/decoder-16.21-macos/profile.json`).json();
if (
  n.kind !== "native-world-effect-helper-observations" ||
  n.counts.roots !== 10 ||
  n.counts.returningRoots !== 10 ||
  n.counts.frames !== 120 ||
  n.counts.restoredFrames !== 60 ||
  n.scope.partialActorSelection ||
  !n.scope.originalWorldFactoryHelper ||
  !n.scope.suppliedSingleDefinitionResolver ||
  !n.scope.unitContextsSuppliedEmpty ||
  n.scope.decodedDescriptorFinalization ||
  n.scope.entityBoneAttachments ||
  n.scope.replayWorldStateRecovered ||
  n.decoderImageSha256 !== sha(image) ||
  n.build !== profile.clientVersion ||
  n.protocol !== profile.protocolDigest
)
  throw Error("Complete matching world helper native evidence required");
for (const [path, digest] of Object.entries(n.inputs))
  if (sha(await raw(path)) !== digest)
    throw Error("World helper input changed");
for (const [name, digest] of Object.entries(n.sources))
  if (sha(await raw(`${root}/tools/${name}`)) !== digest)
    throw Error(`World helper producer changed: ${name}`);
for (const b of n.originalBlocks)
  if (sha(image.subarray(b.rva, b.rva + b.size)) !== b.sha256)
    throw Error("Original world helper instructions changed");
const result = {
  schema: 1,
  kind: "prepared-world-effect-helper-abi",
  build: n.build,
  protocol: n.protocol,
  decoderImageSha256: sha(image),
  parentRuntimeAbiSha256: sha(
    await raw(`${assets}/latest-parent-frame-runtime/package.json`),
  ),
  effectsManifestSha256: sha(
    await raw(`${assets}/latest-effects/manifest.json`),
  ),
  observationSha256: sha(bytes),
  preparerSha256: sha(await raw(import.meta.path)),
  supportedRoots: n.cases.map((c) => c.effectId),
  entries: {
    worldManager: 0x54a4d0,
    wrapperRegistration: 0x374c00,
    wrapperConfig: 0x6143e0,
    resolverConstructor: 0x16659b0,
    helper: 0x377550,
    activate: 0x1765960,
  },
  globals: { worldManager: 0x24722c0, wrapperConfig: 0x246c568 },
  inputs: {
    vectors: 0x100e6000,
    position: 0x100e6100,
    output: 0x100e6200,
    auxiliaries: 0x100e6300,
  },
  nextPrime: {
    rva: 0x1fee34e,
    symbol: "__ZNSt3__112__next_primeEm",
    maximumInput: 65536,
  },
  sourceBlocks: n.originalBlocks,
  scope: {
    staticBuildDataOnly: true,
    containsReplayEvents: false,
    originalWorldHelperObserved: true,
    suppliedSingleDefinitionResolver: true,
    unitContextsSuppliedEmpty: true,
    suppliedClockSeedAndPosition: true,
    decodedDescriptorFinalization: false,
    entityBoneAttachments: false,
    replayWorldStateRecovered: false,
    browserExecuted: false,
    referenceCompared: false,
  },
};
const encoded = JSON.stringify(result, null, 2);
await Bun.write(`${assets}/latest-world-effect-abi/package.json`, encoded);
console.log(
  JSON.stringify({ sha256: sha(encoded), roots: result.supportedRoots.length }),
);
