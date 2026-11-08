// Exact-build extension for the original pre-submission draw parameter prefix.
import { resolve } from "node:path";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = await Bun.file(p).bytes();
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  nPath = `${cache}/research/parent-draw-parameters-native.json`,
  n = await read(nPath),
  catalogPath = `${assets}/latest-parent-draw-caches/package.json`,
  catalog = await read(catalogPath),
  profile = await read(`${assets}/decoder-16.21-macos/profile.json`),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`);
if (
  n.kind !== "original-parent-draw-parameter-observations" ||
  n.scope.partialSelection ||
  n.counts.roots !== 14 ||
  n.counts.returningRoots !== 14 ||
  n.counts.frames !== 56 ||
  n.counts.checkpointContinuations !== 28 ||
  n.counts.drawParameterRecords !== 332 ||
  n.build !== profile.clientVersion ||
  n.protocol !== profile.protocolDigest ||
  n.decoderImageSha256 !== sha(image) ||
  catalog.kind !== "prepared-parent-draw-parameter-caches" ||
  catalog.observationSha256 !== inputs[nPath] ||
  catalog.caches.length !== 14 ||
  !n.scope.originalParameterConstructor ||
  !n.scope.originalRegistryInsertionAndLookup ||
  !n.scope.originalDrawPrefixAndSetters ||
  n.scope.materialApplicationExecuted ||
  n.scope.gpuDrawSubmitted
)
  throw Error(
    "Complete exact-build original draw parameter observations required",
  );
for (const [name, digest] of Object.entries(n.sources))
  if (sha(await raw(`${root}/tools/${name}`)) !== digest)
    throw Error(`Draw parameter producer changed: ${name}`);
for (const [path, digest] of Object.entries(n.inputs))
  if (sha(await raw(path)) !== digest)
    throw Error("Draw parameter observation input changed");
for (const block of n.originalBlocks)
  if (sha(image.subarray(block.rva, block.rva + block.size)) !== block.sha256)
    throw Error("Draw parameter original code differs");
const meta = {
  schema: 1,
  kind: "prepared-original-parent-draw-parameter-abi",
  build: n.build,
  protocol: n.protocol,
  decoderImageSha256: n.decoderImageSha256,
  nativeObservationSha256: inputs[nPath],
  cachePackageSha256: inputs[catalogPath],
  prefix: [0x173d5f0, 0x173d909],
  parameterFactoryRva: 0x1928420,
  parameterVtableRva: 0x2408b98,
  registryInsertRva: 0x191a7d0,
  registryLookupRva: 0x1913b10,
  nameHashRva: 0x1ac6af0,
  parameterBytes: 0x38,
  slotVectors: n.slots,
  sceneBytes: 0x300,
  matrixOffset: 0x264,
  memcmp: {
    rva: 0x1feea3e,
    symbol: "_memcmp",
    maximumBytes: 64,
    callerRvas: [0x1916fbf, 0x19170f6, 0x192c630],
    model:
      "first unsigned-byte difference; admitted callers consume zero/nonzero only",
    macosLibcCompared: false,
  },
  inputs,
  preparerSha256: sha(await raw(import.meta.path)),
  scope: {
    staticBuildDataOnly: true,
    containsReplayEvents: false,
    originalDrawPrefix: true,
    explicitOwnedSharedStorage: true,
    projectionPoseClockOffsetSupplied: true,
    completeMaterialApplication: false,
    gpuSubmission: false,
    browserExecuted: false,
    referenceCompared: false,
  },
};
const bytes = JSON.stringify(meta);
await Bun.write(`${assets}/latest-parent-draw-parameters/package.json`, bytes);
console.log(
  JSON.stringify({
    sha256: sha(bytes),
    cachePackageSha256: inputs[catalogPath],
    counts: n.counts,
  }),
);
