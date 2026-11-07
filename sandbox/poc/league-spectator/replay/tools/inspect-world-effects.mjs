// Shared original world-helper creation through the actual CPU parent runtime.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { createLatestParentFrames } from "../latest-parent-frames.mjs";
import { createLatestWorldEffectFactory } from "../latest-world-effect-factory.mjs";
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
  nativeBytes = await raw(`${cache}/research/world-effects-native.json`),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  profile = await read(`${assets}/decoder-16.21-macos/profile.json`),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`),
  worldFactoryBytes = await raw(
    `${assets}/latest-world-effect-abi/package.json`,
  ),
  worldAbi = JSON.parse(new TextDecoder().decode(worldFactoryBytes)),
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
    worldFactoryBytes,
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
  native.kind === "native-world-effect-helper-observations" &&
    native.counts.roots === 10 &&
    native.counts.returningRoots === 10 &&
    !native.scope.partialActorSelection &&
    native.decoderImageSha256 === sha(image) &&
    worldAbi.observationSha256 === sha(nativeBytes) &&
    cases.length,
  "Complete native world helper reference required",
);
for (const [name, digest] of Object.entries(native.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === digest,
    `Native world helper producer changed: ${name}`,
  );
for (const [p, digest] of Object.entries(native.inputs))
  check(sha(await raw(p)) === digest, "Native world helper input changed");
for (const b of native.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Original world helper instructions changed",
  );
for (const c of cases) {
  const ref = catalog.caches.find((r) => r.effectId === c.effectId),
    runtime = await createLatestParentFrames({
      ...common,
      cacheBytes: await raw(`${assets}/latest-parent-frame-caches/${ref.file}`),
    });
  try {
    const world = await createLatestWorldEffectFactory({
      runtime,
      effectsManifestBytes,
    });
    if (!isDeepStrictEqual(world.initial, c.world)) {
      await Bun.write(
        `${cache}/research/world-effects-difference.json`,
        JSON.stringify(
          {
            stage: "initialization",
            effectId: c.effectId,
            actual: world.initial,
            expected: c.world,
          },
          null,
          2,
        ),
      );
      throw Error(`World helper initialization differs: ${c.effectId}`);
    }
    const creation = world.create({
      resourceKey: c.creation.resourceKey,
      position: c.creation.position,
      seed: BigInt(c.seed),
      clock: { ...c.clockInput, ticks: c.clockInput.ticks.map(BigInt) },
    });
    for (const [key, expected] of Object.entries(c.creation)) {
      if (!isDeepStrictEqual(creation[key], expected)) {
        await Bun.write(
          `${cache}/research/world-effects-difference.json`,
          JSON.stringify(
            {
              stage: "creation",
              effectId: c.effectId,
              key,
              actual: creation[key],
              expected,
            },
            null,
            2,
          ),
        );
        throw Error(
          `World helper creation field differs: ${c.effectId}:${key}`,
        );
      }
      counts.creationFieldComparisons++;
    }
    const handle = creation.parent;
    let checkpoint;
    for (const expected of c.frames) {
      const actual = runtime.advance(handle, expected.time, 20);
      actual.geometry = runtime.render(handle, native.camera);
      const reference = Object.fromEntries(
        ["time", "substeps", "state", "geometry"].map((k) => [k, expected[k]]),
      );
      if (!isDeepStrictEqual(actual, reference)) {
        await Bun.write(
          `${cache}/research/world-effects-difference.json`,
          JSON.stringify(
            {
              stage: "frame",
              effectId: c.effectId,
              tick: expected.tick,
              actual,
              expected: reference,
            },
            null,
            2,
          ),
        );
        throw Error(
          `World-created parent frame differs: ${c.effectId}:${expected.tick}`,
        );
      }
      counts.forwardFrames++;
      counts.geometryRecords += actual.geometry.length;
      if (expected.tick === 6) checkpoint = runtime.checkpoint();
    }
    runtime.restore(checkpoint);
    for (const expected of c.frames.slice(6)) {
      const actual = runtime.advance(handle, expected.time, 20);
      actual.geometry = runtime.render(handle, native.camera);
      check(
        isDeepStrictEqual(
          actual,
          Object.fromEntries(
            ["time", "substeps", "state", "geometry"].map((k) => [
              k,
              expected[k],
            ]),
          ),
        ),
        "World-created parent reverse seek changed state/geometry",
      );
      counts.restoredFrames++;
    }
    runtime.releaseCheckpoint(checkpoint);
    counts.roots++;
    results.push({
      effectId: c.effectId,
      status: "world-created-and-compared",
      frames: c.frames.length,
    });
    console.log(JSON.stringify(results.at(-1)));
  } finally {
    runtime.close();
  }
}
const browser = await Bun.build({
  entrypoints: [`${root}/latest-world-effect-factory.mjs`],
  target: "browser",
  write: false,
});
check(browser.success, "World effect factory browser bundle failed");
const sources = {};
for (const name of [
  "latest-parent-frames.mjs",
  "latest-world-effect-abi.mjs",
  "latest-world-effect-factory.mjs",
  "tools/prepare-world-effect-abi.mjs",
  "tools/inspect-world-effects.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const result = {
  schema: 1,
  kind: "native-wasm-world-effect-helper-comparison",
  inputs,
  sources,
  counts,
  results,
  mismatchCount: 0,
  scope: {
    partialActorSelection: Boolean(effect),
    originalWorldHelperAndActivation: true,
    actualParentRuntimeAndSeeking: true,
    suppliedSingleDefinitionResolver: true,
    unitContextsSuppliedEmpty: true,
    suppliedClockSeedAndPosition: true,
    decodedDescriptorFinalization: false,
    entityBoneAttachments: false,
    replayWorldStateRecovered: false,
    browserBundleBuilt: true,
    browserExecuted: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/world-effects-${effect ? "partial-" : ""}comparison.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ counts, mismatchCount: 0 }));
