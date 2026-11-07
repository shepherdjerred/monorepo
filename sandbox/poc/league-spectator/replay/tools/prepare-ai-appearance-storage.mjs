// Build-only storage contract. Replay events, units and cache instances stay local.
import { resolve } from "node:path";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  sha = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  raw = (path) => Bun.file(path).bytes(),
  read = async (path) => JSON.parse(new TextDecoder().decode(await raw(path))),
  check = (value, message) => {
    if (!value) throw Error(message);
  },
  proof = await read(`${cache}/research/ai-appearance-transitions-native.json`),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
check(
  proof.completeControls &&
    proof.boundaries.length === 0 &&
    proof.records.length > 0 &&
    proof.controls.length === 9 &&
    proof.scope.originalUnitConstructorsExecuted &&
    proof.scope.originalPacketHandlersAndVirtualUnitPreludesExecuted &&
    proof.scope.stoppedBeforeProjectionPerOperation &&
    !proof.scope.acceptedLiveAppearanceRecovered &&
    !proof.scope.assetReadinessVerified &&
    !proof.scope.mainViewerExpanded &&
    proof.build === profile.clientVersion &&
    proof.protocol === profile.protocolDigest &&
    sha(image) === profile.decoderImageSha256,
  "Complete scoped original AI appearance storage comparison required",
);
for (const [path, digest] of Object.entries(proof.inputs))
  check(sha(await raw(path)) === digest, "AI appearance storage input changed");
for (const [name, digest] of Object.entries(proof.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === digest,
    "AI appearance storage source changed",
  );
for (const b of proof.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Executed AI appearance instructions changed",
  );
const ranges = [
    [0x66230, 0x66310],
    [0x66310, 0x668c0],
    [0x66cc0, 0x67000],
    [0x67c20, 0x67c60],
    [0xcb820, 0xcbd40],
    [0xcc120, 0xcc160],
    [0xf7700, 0xf7d20],
    [0x6143e0, 0x6144a0],
    [0x8b0550, 0x8b05a0],
  ],
  meta = {
    schema: 1,
    kind: "prepared-original-ai-appearance-storage",
    build: proof.build,
    protocol: proof.protocol,
    decoderImageSha256: sha(image),
    constructorImageSha256: profile.constructorImageSha256,
    sourceBlocks: ranges.map(([startRva, endRva]) => ({
      startRva,
      endRva,
      sha256: sha(image.subarray(startRva, endRva)),
    })),
    defaultEntry: {
      flags: [true, false, true, true, true],
      gearIndex: 255,
      modifierNames: [],
      alternateCharacterA: "",
      alternateCharacterB: "",
      entryId: 0,
      overrideMask: 1,
      alternateSkinA: 0,
      alternateSkinB: 0,
    },
    contract: {
      operations: [984, 459, 1045],
      pop: "first-matching-entry-id",
      clear: "all-entries",
      skinSentinel: 0xffffffff,
      inheritedSkin: "last-entry-with-mask-equal-16-else-default",
      alternateInheritedSkin: "default",
      preloadFlag: false,
      modifierNames: "empty",
      alternateCharacters: "empty",
      checkpointInterval: 16,
    },
    scope: {
      staticBuildDataOnly: true,
      containsReplayEvents: false,
      originalColdUnitStoragePrefixesExecuted: true,
      suppliedDefaultAppearanceCandidates: true,
      suppliedCacheKeysOnly: true,
      liveWorldRouteVerified: false,
      acceptedLiveAppearanceRecovered: false,
      assetReadinessVerified: false,
      postProjectionCallbacksExecuted: false,
      mainViewerExpanded: false,
    },
    producerSha256: sha(await raw(import.meta.path)),
  },
  bytes = new TextEncoder().encode(JSON.stringify(meta, null, 2));
await Bun.write(
  `${cache}/public/latest-ai-appearance-storage/package.json`,
  bytes,
);
console.log(
  JSON.stringify({
    packageSha256: sha(bytes),
    operations: proof.records.length,
    syntheticControls: proof.controls.length,
  }),
);
