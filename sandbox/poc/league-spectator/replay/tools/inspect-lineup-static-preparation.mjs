import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { createLatestEffectContexts } from "../latest-effect-contexts.mjs";
import { loadLatestViewerPoseAssets } from "../latest-viewer-pose-assets.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-lineup-5667809143"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Static input changed");
  inputs[path] = hash;
  return bytes;
}
const decode = (bytes) => JSON.parse(new TextDecoder().decode(bytes)),
  read = async (path) => decode(await raw(path)),
  load = (path) => raw(`${cache}/public/${path}`);
await captureDirectSourceInputs([import.meta.path], raw);
const report = await read(`${cache}/research/decoded-semantics-99.json`),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  scene = await read(`${cache}/public/latest-scene/manifest.json`),
  manifestBytes = await load("latest-effects/manifest.json"),
  effects = decode(manifestBytes),
  request = await read(`${cache}/research/requested-latest-scene.json`);
if (
  scene.build !== report.build ||
  effects.build !== report.build ||
  report.build !== "16.21.829.8620" ||
  scene.protocol !== report.protocol ||
  effects.protocol !== report.protocol
)
  throw Error("Exact second-lineup build required");
const skins = report.heroes.map((hero) => {
  const key = `${hero.champion.toLowerCase()}/${hero.skinId}`,
    asset = scene.champions[key];
  if (
    !asset ||
    asset.champion !== hero.champion ||
    asset.skinId !== hero.skinId ||
    !effects.actors[`champions/${key}`]
  )
    throw Error("Decoded skin lacks installed asset validation");
  return {
    entityId: hero.entityId,
    champion: hero.champion,
    skinId: hero.skinId,
    actorKey: key,
    equippedIdentityStatus: hero.skinIdStatus,
    installedAssetsPrepared: true,
  };
});
if (skins.length !== 10 || request.champions.length !== 10)
  throw Error("Complete ten-hero static request required");
for (const ref of Object.values(effects.definitions))
  if ((await sha256(await load(`latest-effects/${ref.file}`))) !== ref.sha256)
    throw Error("Effect definition hash differs");
const omissions = [],
  prepared = [];
for (const [path, ref] of Object.entries(effects.assets)) {
  if (ref.status !== "prepared") {
    omissions.push({ path, ...ref });
    continue;
  }
  if (
    !ref.file ||
    !ref.sha256 ||
    (await sha256(await load(`latest-effects/${ref.file}`))) !== ref.sha256
  )
    throw Error("Prepared effect resource differs: " + path);
  if (
    ref.rawFile &&
    (await sha256(await load(`latest-effects/${ref.rawFile}`))) !==
      ref.sourceSha256
  )
    throw Error("Raw installed resource differs: " + path);
  prepared.push({ path, kind: ref.kind, sha256: ref.sha256 });
}
for (const [field, path] of [
  ["animationRigsSha256", "decoder-16.21-macos/animation-rigs.json"],
  ["animationClockSha256", "decoder-16.21-macos/animation-clock.json"],
  ["animationEventsSha256", "decoder-16.21-macos/animation-events.json"],
  ["animationPosesSha256", "latest-animation-poses/manifest.json"],
])
  if ((await sha256(await load(path))) !== profile[field])
    throw Error("Regenerated animation package differs: " + field);
const blockers = [];
async function blocked(label, action, expected) {
  let message;
  try {
    await action();
  } catch (error) {
    message = error.message;
  }
  if (message !== expected)
    throw Error(`Integration frontier changed (${label}): ${message}`);
  blockers.push({ label, error: message });
}
await blocked(
  "selected-context-catalog",
  async () =>
    createLatestEffectContexts({
      profile,
      image: undefined,
      packageBytes: await load("latest-effect-contexts/package.json"),
      effectsManifestBytes: manifestBytes,
    }),
  "Pinned effect context package/image required",
);
await blocked(
  "selected-viewer-pose-catalog",
  () => loadLatestViewerPoseAssets({ profile, report, scene, load }),
  "Pinned static viewer pose package differs",
);
const heroes = new Set(report.heroes.map((hero) => hero.entityId)),
  window = (row) => row.time >= 69 && row.time <= 99;
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error("Static source changed: " + path);
const output = `${cache}/research/static-preparation-verification.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "isolated-second-lineup-static-preparation-verification",
      inputs,
      build: report.build,
      protocol: report.protocol,
      replaySha256: report.replaySha256,
      skins,
      decodedWindow: {
        from: 69,
        to: 99,
        effectCreationRequests: report.effectCreations.filter(window).length,
        missileRecords: report.missiles.filter(window).length,
        heroAttacks: report.attacks.filter(
          (row) => window(row) && heroes.has(row.entityId),
        ).length,
        heroCasts: report.casts.filter(
          (row) => window(row) && heroes.has(row.entityId),
        ).length,
      },
      prepared: {
        definitions: Object.keys(effects.definitions).length,
        resources: prepared.length,
        resourceKinds: prepared.reduce(
          (counts, row) => (
            (counts[row.kind] = (counts[row.kind] ?? 0) + 1),
            counts
          ),
          {},
        ),
      },
      resourceOmissions: omissions,
      integrationBlockers: blockers,
      scope: {
        staticAssetHashesVerified: true,
        installedSkinAssetValidation: true,
        runtimeResolved: null,
        runtimeActivated: null,
        renderedInstances: null,
        browserVerified: false,
        mapVariant: "explicit Map12 base policy; KIWI visual parity unverified",
        equippedSkinNativeStateRecovered: false,
        primaryCacheMutated: false,
        selectedCatalogIntegrationRequired: true,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    skins: skins.length,
    definitions: Object.keys(effects.definitions).length,
    preparedResources: prepared.length,
    omissions: omissions.length,
    blockers,
  }),
);
