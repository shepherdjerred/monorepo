import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { animationHash } from "../latest-animation.mjs";
import {
  createAttachedMeshResources,
  createAttachedMeshMaskCache,
  createLatestAttachedMeshBindings,
  ATTACHED_MESH_SHA,
} from "../latest-attached-mesh.mjs";
const [arg] = process.argv.slice(2);
if (!arg) throw Error("Usage: inspect-attached-mesh.mjs <cache>");
const cache = resolve(arg),
  root = resolve(import.meta.dir, ".."),
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = new Uint8Array(await Bun.file(p).arrayBuffer());
    inputs[p] = sha(b);
    return b;
  },
  json = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  same = (a, b, m) => check(isDeepStrictEqual(a, b), m),
  nativePath = `${cache}/research/attached-mesh-native.json`,
  native = await json(nativePath),
  profile = await json(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`),
  sceneBytes = await raw(`${cache}/public/latest-scene/manifest.json`),
  scene = JSON.parse(new TextDecoder().decode(sceneBytes)),
  subBytes = await raw(
    `${cache}/public/latest-submesh-visibility/package.json`,
  ),
  effectsBytes = await raw(`${cache}/public/latest-effects/manifest.json`),
  effects = JSON.parse(new TextDecoder().decode(effectsBytes)),
  bytes = await raw(`${cache}/public/latest-attached-mesh/package.json`),
  factory = await createLatestAttachedMeshBindings(
    profile,
    sceneBytes,
    subBytes,
    effectsBytes,
    bytes,
  ),
  meta = factory.metadata,
  post = await json(`${cache}/public/decoder-16.21-macos/vfx-postload.json`);
check(
  native.packageSha256 === ATTACHED_MESH_SHA &&
    native.preparerSha256 ===
      sha(await raw(`${root}/tools/prepare-attached-mesh.py`)) &&
    sha(image) === profile.decoderImageSha256,
  "Attached native source/package changed",
);
for (const [p, h] of Object.entries(native.inputs))
  check(sha(await raw(p)) === h, "Attached mesh input changed");
for (const [name, h] of Object.entries(native.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === h,
    "Attached native helper changed",
  );
for (const b of native.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Attached original instruction changed",
  );
for (const b of meta.sourceBlocks)
  check(
    sha(image.subarray(b.startRva, b.endRva)) === b.sha256,
    "Attached source block changed",
  );
let cacheChecks = 0,
  drawMaskChecks = 0,
  secondPassChecks = 0,
  channelChecks = 0,
  checkpointChecks = 0,
  reloadChecks = 0,
  unresolvedLists = 0;
const hash = (name) => parseInt(animationHash(name).slice(1, -1), 16),
  ranges = (names) => {
    const masks = new Map();
    names.forEach((name, i) =>
      masks.set(hash(name), ((masks.get(hash(name)) ?? 0) | (1 << i)) >>> 0),
    );
    return names.map((name, index) => ({
      name,
      index,
      hash: hash(name),
      mask: masks.get(hash(name)),
    }));
  };
for (const n of native.observations) {
  const ref = meta.entries[n.key],
    source = post.emitters[n.key],
    definition = effects.definitions[ref.effectId];
  check(
    source.effectId === ref.effectId &&
      source.emitterIndex === ref.emitterIndex &&
      source.sha256 === ref.postloadGraphSha256 &&
      source.definitionSha256 === ref.sourceDefinitionSha256 &&
      definition.sha256 === ref.sourceDefinitionSha256,
    "Attached source join differs",
  );
  const pool = createAttachedMeshResources(),
    resources = [
      null,
      pool.create(ranges(n.names)),
      pool.create(ranges(n.alternateNames)),
    ],
    spec = {
      drawHashes: ref.drawHashes,
      alwaysHashes: ref.alwaysHashes,
      useAvatarMask: ref.useAvatarMask,
    },
    c = createAttachedMeshMaskCache(spec, pool),
    saved = [];
  for (const f of n.frames) {
    const checkpoint = c.checkpoint(),
      a = c.resolve(resources[f.input]);
    same(
      {
        resource: f.input,
        selectedMask: a.selectedMask,
        alwaysMask: a.alwaysMask,
      },
      f.output,
      "Native cached mesh masks differ",
    );
    cacheChecks++;
    unresolvedLists +=
      +(a.unresolvedDrawHashes.length > 0) +
      +(a.unresolvedAlwaysHashes.length > 0);
    for (const d of f.draws) {
      check(
        c.drawMask(d.ownerMask, d.ownerMask) === d.drawMask,
        "Native attached draw mask differs",
      );
      drawMaskChecks++;
      check(
        d.secondPassMask === d.drawMask,
        "Native draw-pass projection differs",
      );
      secondPassChecks++;
    }
    c.restore(checkpoint);
    same(
      c.resolve(resources[f.input]),
      a,
      "Attached resource checkpoint differs",
    );
    checkpointChecks++;
    c.releaseCheckpoint(checkpoint);
    saved.push(a);
  }
  const fresh = createAttachedMeshMaskCache(spec, pool);
  for (const [i, f] of n.frames.entries()) {
    same(
      fresh.resolve(resources[f.input]),
      saved[i],
      "Attached reload differs",
    );
    reloadChecks++;
  }
  for (const route of n.channels) {
    const cc = createAttachedMeshMaskCache(
      { ...spec, useAvatarMask: route.value },
      pool,
    );
    cc.resolve(resources[1]);
    const nativeFrame = n.frames[1],
      expected = nativeFrame.draws.find(
        (d) => d.ownerMask === (route.channel === 0 ? 0 : 0xffffffff),
      );
    check(
      cc.drawMask(0, 0xffffffff) === expected.drawMask,
      "Original owner mask channel differs",
    );
    channelChecks++;
  }
}
const resources = [];
let appearanceChecks = 0;
for (const a of Object.values(scene.champions)) {
  resources.push(
    await factory.createResource(
      a,
      await raw(`${cache}/public/latest-scene/${a.model}`),
      await raw(`${cache}/public/latest-scene/${a.animationGraph}`),
    ),
  );
  appearanceChecks++;
}
const gaps = await json(`${cache}/research/submesh-visibility-comparison.json`),
  sample = gaps.cases.find((c) => c.label === "Viego · death +1s"),
  asset = scene.champions[sample.asset],
  owner = await factory.createResource(
    asset,
    await raw(`${cache}/public/latest-scene/${asset.model}`),
    await raw(`${cache}/public/latest-scene/${asset.animationGraph}`),
  ),
  effectId = "champions/viego/43/4f77a64e",
  layers = [];
for (const index of [14, 15, 16, 17]) {
  const c = factory.createCache(effectId, index);
  c.resolve(owner);
  const ref = meta.entries[`${effectId}:${index}`],
    mask = c.drawMask(sample.mask, 0xffffffff);
  layers.push({
    emitterIndex: index,
    name: ref.emitterName,
    mask,
    parts: factory
      .ranges(owner)
      .filter((r) => r.mask & mask)
      .map((r) => r.name),
  });
}
check(
  layers.find((l) => l.emitterIndex === 15).parts.includes("Body") &&
    !(sample.mask & factory.ranges(owner).find((r) => r.name === "Body").mask),
  "Attached body override not preserved",
);
let rejectionChecks = 0;
const badPool = createAttachedMeshResources();
for (const fn of [
  () =>
    createLatestAttachedMeshBindings(
      { ...profile, clientVersion: "other" },
      sceneBytes,
      subBytes,
      effectsBytes,
      bytes,
    ),
  () =>
    createLatestAttachedMeshBindings(
      profile,
      sceneBytes,
      subBytes,
      effectsBytes,
      new Uint8Array([0]),
    ),
  () =>
    createLatestAttachedMeshBindings(
      profile,
      sceneBytes,
      subBytes,
      new Uint8Array([0]),
      bytes,
    ),
  () => factory.createCache(effectId, 10000),
  () => factory.createCache(effectId, -1),
  () => factory.ranges({}),
  () => badPool.create([{ index: 0, hash: 0, mask: 0 }]),
  () => badPool.create([]),
  () =>
    createAttachedMeshMaskCache(
      { drawHashes: [-1], alwaysHashes: [], useAvatarMask: false },
      badPool,
    ),
  () =>
    createAttachedMeshMaskCache(
      { drawHashes: [], alwaysHashes: [], useAvatarMask: 1 },
      badPool,
    ),
  () =>
    createAttachedMeshMaskCache(
      { drawHashes: [], alwaysHashes: [], useAvatarMask: false, extra: 1 },
      badPool,
    ),
  () => factory.createCache(effectId, 15).drawMask(NaN, 0),
  () =>
    factory
      .createCache(effectId, 15)
      .resolve(badPool.create([{ index: 0, hash: 1, mask: 1 }])),
  () => factory.createCache(effectId, 15).restore({}),
]) {
  let rejected = false;
  try {
    await fn();
  } catch {
    rejected = true;
  }
  check(rejected, "Invalid attached mesh input accepted");
  rejectionChecks++;
}
const sources = {};
for (const name of [
  "latest-attached-mesh.mjs",
  "latest-submesh-visibility.mjs",
  "latest-animation.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const counts = {
  emitters: native.observations.length,
  cacheChecks,
  drawMaskChecks,
  secondPassChecks,
  channelChecks,
  checkpointChecks,
  reloadChecks,
  appearanceChecks,
  unresolvedLists,
  rejectionChecks,
};
check(
  cacheChecks === native.counts.cacheChecks &&
    drawMaskChecks === native.counts.drawMaskChecks &&
    secondPassChecks === native.counts.secondPassChecks &&
    channelChecks === native.counts.channelChecks,
  "Attached native coverage differs",
);
await Bun.write(
  `${cache}/research/attached-mesh-comparison.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "attached-mesh-selection-comparison",
      packageSha256: ATTACHED_MESH_SHA,
      nativeEvidenceSha256: inputs[nativePath],
      inspectorSha256: sha(await raw(import.meta.path)),
      inputs,
      sources,
      counts,
      example: { ...sample, effectId, layers },
      scope: {
        ...native.scope,
        browserCompatibleTranslationCompared: true,
        checkpointsCompared: true,
        diagnosticOwnerMasksSupplied: true,
        browserRun: false,
      },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(counts));
