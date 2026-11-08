import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { loadLatestStaticCatalogSelection } from "../latest-static-catalog.mjs";
import {
  createLatestCorpsePolicy,
  CORPSE_POLICY_SHA,
} from "../latest-corpse.mjs";
import {
  createLatestSubmeshVisibility,
  SUBMESH_VISIBILITY_SHA,
} from "../latest-submesh-visibility.mjs";
import { stringifyAssetJson } from "./asset-json.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-lineup-5667809143"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Selected input changed: ${path}`);
  inputs[path] = digest;
  return bytes;
}
const load = (path) => raw(`${cache}/public/${path}`),
  decode = (bytes) => JSON.parse(new TextDecoder().decode(bytes)),
  encode = (value) => new TextEncoder().encode(stringifyAssetJson(value));
await captureDirectSourceInputs([import.meta.path], raw);
const selection = await loadLatestStaticCatalogSelection({ load }),
  profile = selection.profile(),
  sceneBytes = await selection.readRole("scene"),
  scene = decode(sceneBytes),
  worldBytes = await selection.read(`latest-scene/${scene.world}`),
  world = decode(worldBytes),
  corpseBytes = await selection.readRole("corpsePolicy"),
  submeshBytes = await selection.readRole("submeshVisibility"),
  corpse = await createLatestCorpsePolicy(
    profile,
    sceneBytes,
    worldBytes,
    corpseBytes,
    selection,
  ),
  submesh = await createLatestSubmeshVisibility(
    profile,
    sceneBytes,
    submeshBytes,
    selection,
  );
let corpseAssets = 0,
  submeshAssets = 0,
  sampledClips = 0,
  explicitGraphicsOmissions = 0;
for (const [key, asset] of Object.entries(corpse.metadata.assets)) {
  const duration = corpse.bind(key, Object.keys(asset.records));
  if (
    !corpse.retainsTicks(true, Math.round(duration * 1e9), duration).retained ||
    corpse.retainsTicks(true, Math.round((duration + 0.001) * 1e9), duration)
      .retained
  )
    throw Error("Actual selected corpse boundary differs");
  corpseAssets++;
}
for (const asset of [
  ...Object.values(scene.champions),
  ...Object.values(world.assets).filter((value) => value.animationGraph),
]) {
  const binding = await submesh.bind(
      asset,
      await selection.read(`latest-scene/${asset.model}`),
      await selection.read(`latest-scene/${asset.animationGraph}`),
    ),
    entry = submesh.metadata.assets[asset.animationGraph];
  for (const name of entry.allClips) {
    if (entry.clips[name]?.events.some((event) => event.avatarOnly)) {
      try {
        binding.sample(name, 0);
        throw Error("Avatar-only graphics unexpectedly admitted");
      } catch (error) {
        if (!error.message.includes("Avatar-only graphics composition"))
          throw error;
      }
      explicitGraphicsOmissions++;
    } else {
      binding.sample(name, 0);
      sampledClips++;
    }
  }
  submeshAssets++;
}
const rejections = [];
async function rejects(label, run, expected) {
  try {
    await run();
  } catch (error) {
    if (!error.message.includes(expected))
      throw Error(`${label}: wrong rejection: ${error.message}`);
    rejections.push({ label, message: error.message });
    return;
  }
  throw Error(`${label}: malformed input accepted`);
}
let legacyPinnedFactoriesAccepted = 0;
if ((await sha256(corpseBytes)) === CORPSE_POLICY_SHA) {
  await createLatestCorpsePolicy(profile, sceneBytes, worldBytes, corpseBytes);
  legacyPinnedFactoriesAccepted++;
} else
  await rejects(
    "nonreference corpse without selected ownership",
    () =>
      createLatestCorpsePolicy(profile, sceneBytes, worldBytes, corpseBytes),
    "Pinned corpse",
  );
if ((await sha256(submeshBytes)) === SUBMESH_VISIBILITY_SHA) {
  await createLatestSubmeshVisibility(profile, sceneBytes, submeshBytes);
  legacyPinnedFactoriesAccepted++;
} else
  await rejects(
    "nonreference submesh without selected ownership",
    () => createLatestSubmeshVisibility(profile, sceneBytes, submeshBytes),
    "Pinned submesh",
  );
await rejects(
  "corpse lookalike owner",
  () =>
    createLatestCorpsePolicy(profile, sceneBytes, worldBytes, corpseBytes, {
      assertRole() {},
    }),
  "Owned selected static catalog required",
);
await rejects(
  "submesh lookalike owner",
  () =>
    createLatestSubmeshVisibility(profile, sceneBytes, submeshBytes, {
      assertRole() {},
    }),
  "Owned selected static catalog required",
);

// A fresh, privately loaded diagnostic root models a fully rehashed yet
// unapproved package. No public catalog/bootstrap or reference is modified.
async function changedRoot(role, edit, editProof = false) {
  const snapshot = selection.describe(),
    overrides = new Map(),
    packagePath = snapshot.roles[role],
    value = decode(await selection.readRole(role));
  edit(value);
  const changed = encode(value);
  overrides.set(packagePath, changed);
  if (editProof) {
    const proofPath = snapshot.roles.submeshVisibilityProof,
      proof = decode(await selection.readRole("submeshVisibilityProof"));
    proof.packageSha256 = await sha256(changed);
    overrides.set(proofPath, encode(proof));
  }
  const catalog = decode(await load(snapshot.catalogPath)),
    bootstrap = decode(await load("latest-static-catalog/bootstrap.json"));
  for (const [path, bytes] of overrides)
    catalog.files[path] = { sha256: await sha256(bytes), bytes: bytes.length };
  const catalogBytes = encode(catalog);
  bootstrap.catalog.sha256 = await sha256(catalogBytes);
  overrides.set(snapshot.catalogPath, catalogBytes);
  overrides.set("latest-static-catalog/bootstrap.json", encode(bootstrap));
  return {
    owner: await loadLatestStaticCatalogSelection({
      load: (path) => overrides.get(path) ?? load(path),
    }),
    bytes: changed,
  };
}
for (const [label, edit] of [
  [
    "corpse lifetime mutation",
    (value) =>
      Object.values(value.assets)[0].records[
        Object.keys(Object.values(value.assets)[0].records)[0]
      ].duration++,
  ],
  [
    "corpse death mode mutation",
    (value) =>
      (value.unitDeathMode.setsDeadFlag[0] =
        !value.unitDeathMode.setsDeadFlag[0]),
  ],
  [
    "corpse native scope mutation",
    (value) => (value.scope.corpseFadeVerified = true),
  ],
]) {
  const changed = await changedRoot("corpsePolicy", edit);
  await rejects(
    label,
    () =>
      createLatestCorpsePolicy(
        profile,
        sceneBytes,
        worldBytes,
        changed.bytes,
        changed.owner,
      ),
    "may rebind only",
  );
}
for (const [label, edit, expected] of [
  [
    "submesh native layout mutation",
    (value) => (value.defaultDataHex = "00"),
    "fixed original program",
  ],
  [
    "submesh missing selected actor",
    (value) => delete value.assets[Object.keys(value.assets)[0]],
    "complete asset/source inventory",
  ],
  [
    "submesh authored mask mutation",
    (value) => (Object.values(value.assets)[0].ranges[0].mask ^= 1),
    "complete asset/source inventory",
  ],
]) {
  const changed = await changedRoot("submeshVisibility", edit, true);
  await rejects(
    label,
    () =>
      createLatestSubmeshVisibility(
        profile,
        sceneBytes,
        changed.bytes,
        changed.owner,
      ),
    expected,
  );
}
const controlled = (value) =>
    value.sequences.filter(
      (row) =>
        !row.name.startsWith("champions/") && !row.name.startsWith("world/"),
    ),
  reorderedMap = await changedRoot("submeshVisibilityProof", (value) => {
    const row = controlled(value)[0];
    row.beginning.mapping = Object.fromEntries(
      Object.entries(row.beginning.mapping).reverse(),
    );
  });
await createLatestSubmeshVisibility(
  profile,
  sceneBytes,
  submeshBytes,
  reorderedMap.owner,
);
for (const [label, edit] of [
  [
    "submesh controlled map value mutation",
    (value) => {
      const mapping = controlled(value)[0].beginning.mapping,
        key = Object.keys(mapping)[0];
      mapping[key] = (mapping[key] ^ 1) >>> 0;
    },
  ],
  [
    "submesh controlled event array reorder",
    (value) => {
      const row = controlled(value).find((row) => row.events.length >= 2);
      [row.events[0], row.events[1]] = [row.events[1], row.events[0]];
    },
  ],
]) {
  const changed = await changedRoot("submeshVisibilityProof", edit);
  await rejects(
    label,
    () =>
      createLatestSubmeshVisibility(
        profile,
        sceneBytes,
        submeshBytes,
        changed.owner,
      ),
    "native control/cohort inventory",
  );
}
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error(`Selected scene policy input changed: ${path}`);
const report = {
  schema: 1,
  kind: "actual-selected-scene-policy-factory-control",
  inputs,
  catalog: selection.describe(),
  corpsePackageSha256: corpse.packageSha256,
  submeshPackageSha256: await sha256(submeshBytes),
  counts: {
    corpseAssets,
    submeshAssets,
    sampledClips,
    explicitGraphicsOmissions,
    malformedRejections: rejections.length,
    mapKeyPermutationAccepted: 1,
    legacyPinnedFactoriesAccepted,
  },
  rejections,
  scope: {
    actualOwnedStaticRootFactoryExecuted: true,
    allSelectedAssetBindingsExecuted: true,
    privateRehashedRootNegativeControls: true,
    publicCatalogUnmodified: true,
    replayDecodingExecuted: false,
    nativeLiveClockRecovered: false,
    graphicsSubmissionExecuted: false,
    browserObserved: false,
  },
};
await Bun.write(
  `${cache}/research/selected-scene-policy-control.json`,
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report.counts));
