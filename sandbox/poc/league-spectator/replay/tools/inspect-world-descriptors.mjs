// Complete original descriptor creation through the shared CPU parent runtime.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { createLatestParentFrames } from "../latest-parent-frames.mjs";
import { createLatestWorldDescriptorFactory } from "../latest-world-descriptor-factory.mjs";
import { createLatestBulkUnicorn } from "../latest-unicorn-bulk.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  effect = process.argv[3],
  assets = `${cache}/public`,
  root = resolve(import.meta.dir, ".."),
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = await Bun.file(p).bytes();
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  nativeBytes = await raw(`${cache}/research/world-descriptors-native.json`),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  profile = await read(`${assets}/decoder-16.21-macos/profile.json`),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`),
  descriptorFactoryBytes = await raw(
    `${assets}/latest-world-descriptor-abi/package.json`,
  ),
  descriptorABI = JSON.parse(new TextDecoder().decode(descriptorFactoryBytes)),
  bulkBytes = await raw(`${assets}/latest-unicorn-bulk/package.json`),
  bulk = JSON.parse(new TextDecoder().decode(bulkBytes)),
  runtimeBytes = await raw(`${assets}/vendor/unicorn_x86_candidate.mjs`),
  { default: factory } = await import(
    pathToFileURL(`${assets}/vendor/unicorn_x86_candidate.mjs`).href
  ),
  uc = await createLatestBulkUnicorn(
    factory,
    runtimeBytes,
    bulkBytes,
    await raw(`${assets}/latest-unicorn-bulk/${bulk.file}`),
  ),
  common = {
    uc,
    profile,
    image,
    descriptorFactoryBytes,
    worldFactoryBytes: await raw(
      `${assets}/latest-world-effect-abi/package.json`,
    ),
    spawnBytes: await raw(`${assets}/decoder-16.21-macos/vfx-spawn.json`),
    abiBytes: await raw(`${assets}/latest-parent-frame-runtime/package.json`),
    cachePackageBytes: await raw(
      `${assets}/latest-parent-frame-caches/package.json`,
    ),
    mathPackageBytes: await raw(`${assets}/latest-parent-math/package.json`),
    loadMathBytes: (f) => raw(`${assets}/latest-parent-math/${f}`),
    loadBytes: (f) => raw(`${assets}/latest-parent-frame-caches/${f}`),
  },
  catalog = JSON.parse(new TextDecoder().decode(common.cachePackageBytes)),
  effectsManifestBytes = await raw(`${assets}/latest-effects/manifest.json`),
  cases = native.cases.filter((c) => !effect || c.effectId === effect),
  counts = {
    roots: 0,
    creationFieldComparisons: 0,
    forwardFrames: 0,
    restoredFrames: 0,
    geometryRecords: 0,
  },
  results = [];
check(
  native.kind === "native-world-descriptor-factory-observations" &&
    native.counts.roots === 10 &&
    native.counts.returningRoots === 10 &&
    !native.scope.partialActorSelection &&
    native.decoderImageSha256 === sha(image) &&
    descriptorABI.observationSha256 === sha(nativeBytes) &&
    cases.length,
  "Complete native descriptor factory reference required",
);
for (const [name, digest] of Object.entries(native.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === digest,
    `Native descriptor producer changed: ${name}`,
  );
for (const [p, digest] of Object.entries(native.inputs))
  check(sha(await raw(p)) === digest, "Native descriptor input changed");
for (const b of native.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Original descriptor instructions changed",
  );
async function compare(actual, expected, stage, effectId) {
  if (!isDeepStrictEqual(actual, expected)) {
    await Bun.write(
      `${cache}/research/world-descriptors-difference.json`,
      JSON.stringify({ stage, effectId, actual, expected }, null, 2),
    );
    throw Error(`Descriptor factory differs: ${effectId}:${stage}`);
  }
}
for (const c of cases) {
  const ref = catalog.caches.find((r) => r.effectId === c.effectId),
    runtime = await createLatestParentFrames({
      ...common,
      cacheBytes: await raw(`${assets}/latest-parent-frame-caches/${ref.file}`),
    });
  try {
    const world = await createLatestWorldDescriptorFactory({
      runtime,
      effectsManifestBytes,
    });
    await compare(world.initial, c.world, "initialization", c.effectId);
    const creation = world.create({
      resourceKey: c.supplied.key,
      position: c.supplied.position,
      scale: c.supplied.scale,
      rate: c.supplied.rate,
      flags: c.supplied.flags,
      seed: BigInt(c.seed),
      clock: { ...c.clockInput, ticks: c.clockInput.ticks.map(BigInt) },
    });
    for (const [key, expected] of Object.entries(c.creation)) {
      await compare(creation[key], expected, `creation:${key}`, c.effectId);
      counts.creationFieldComparisons++;
    }
    const handle = creation.parent;
    let checkpoint;
    for (const expected of c.frames) {
      const actual = runtime.advance(handle, expected.time, 20);
      actual.geometry = runtime.render(handle, native.camera);
      await compare(
        actual,
        Object.fromEntries(
          ["time", "substeps", "state", "geometry"].map((k) => [
            k,
            expected[k],
          ]),
        ),
        `frame:${expected.tick}`,
        c.effectId,
      );
      counts.forwardFrames++;
      counts.geometryRecords += actual.geometry.length;
      if (expected.tick === 6) checkpoint = runtime.checkpoint();
    }
    runtime.restore(checkpoint);
    for (const expected of c.frames.slice(6)) {
      const actual = runtime.advance(handle, expected.time, 20);
      actual.geometry = runtime.render(handle, native.camera);
      await compare(
        actual,
        Object.fromEntries(
          ["time", "substeps", "state", "geometry"].map((k) => [
            k,
            expected[k],
          ]),
        ),
        `restored:${expected.tick}`,
        c.effectId,
      );
      counts.restoredFrames++;
    }
    runtime.releaseCheckpoint(checkpoint);
    counts.roots++;
    results.push({
      effectId: c.effectId,
      status: "descriptor-created-and-compared",
      frames: c.frames.length,
    });
    console.log(JSON.stringify(results.at(-1)));
  } finally {
    runtime.close();
  }
}
const browser = await Bun.build({
  entrypoints: [`${root}/latest-world-descriptor-factory.mjs`],
  target: "browser",
  write: false,
});
check(browser.success, "Descriptor factory browser bundle failed");
const sources = {};
for (const name of [
  "latest-parent-frames.mjs",
  "latest-world-effect-abi.mjs",
  "latest-world-effect-factory.mjs",
  "latest-world-descriptor-abi.mjs",
  "latest-world-descriptor-factory.mjs",
  "tools/prepare-world-descriptor-abi.mjs",
  "tools/inspect-world-descriptors.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const result = {
  schema: 1,
  kind: "native-wasm-world-descriptor-factory-comparison",
  inputs,
  sources,
  counts,
  results,
  mismatchCount: 0,
  scope: {
    partialActorSelection: Boolean(effect),
    completeOriginalDescriptorFactory: true,
    originalContextConstructionAndIdentity: true,
    actualParentRuntimeAndSeeking: true,
    explicitDetachedDescriptors: true,
    suppliedSingleDefinitionResolver: true,
    suppliedClockSeedAndPosition: true,
    decodedReplayRequestsExecuted: false,
    entityBoneAttachments: false,
    replayWorldStateRecovered: false,
    standardSharedOwnershipImportsModeled: true,
    browserBundleBuilt: true,
    browserExecuted: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/world-descriptors-${effect ? "partial-" : ""}comparison.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ counts, mismatchCount: 0 }));
