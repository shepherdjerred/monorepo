// Current world-value check against the scoped original-code oracle.
// This does not admit the helper to an active movement family.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { loadLatestInitialResourcePrefix } from "../latest-initial-resource-prefix.mjs";
import { loadLatestViewerPoseAssets } from "../latest-viewer-pose-assets.mjs";
import { createLatestWorldPresentation } from "../latest-world-presentation.mjs";
import { initializeEmptyBoneCasterStart } from "../latest-missile-caster-start.mjs";
import { createLatestMissileInitialization } from "../latest-missile-initialization.mjs";
import { createOwnedMissileCasterStarts } from "../latest-missile-caster-context.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("World input changed: " + path);
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)));
const load = (path) => raw(`${cache}/public/${path}`);
await captureDirectSourceInputs([import.meta.path], raw);
const exported = await read(
  `${cache}/research/viewer-root-reconstruction.json`,
);
if (
  exported.kind !== "verified-ordinary-reconstruction-diagnostic-export" ||
  exported.runtimePlaybackInput !== false
)
  throw Error("Current ordinary diagnostic world reconstruction required");
for (const [path, hash] of Object.entries(exported.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error("Current reconstruction input changed: " + path);
if (
  (await sha256(await raw(exported.controlReportPath))) !==
  exported.controlReportSha256
)
  throw Error("Ordinary control changed");
const report = exported.report,
  scene = await read(`${cache}/public/latest-scene/manifest.json`),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`);
if (
  report.build !== "16.21.829.8620" ||
  report.protocol !== "20e09df23c66b85e" ||
  report.endTime !== 99
)
  throw Error("Exact comparison world required");
const bytes = await load("latest-scene/heights.bin"),
  terrain = createLatestTerrain(
    scene,
    new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4),
  );
const manifestBytes = await load("latest-effects/manifest.json"),
  initial = await loadLatestInitialResourcePrefix({
    profile,
    report,
    manifestBytes,
    load,
  });
const viewerPoseAssets = await loadLatestViewerPoseAssets({
  profile,
  report,
  scene,
  load,
});
const world = createLatestWorldPresentation({
  report,
  scene,
  terrain,
  initialResourcePrefix: initial.policy,
  viewerPoseAssets,
});
const native = await read(`${cache}/research/missile-caster-start-native.json`);
for (const [path, hash] of Object.entries(native.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error("Current native caster input changed: " + path);
const rigsBytes = await load("decoder-16.21-macos/animation-rigs.json");
if ((await sha256(rigsBytes)) !== profile.animationRigsSha256)
  throw Error("Original constructed rig inventory changed");
const rigs = JSON.parse(new TextDecoder().decode(rigsBytes)),
  cases = [],
  prepared = [];
const controllerBytes = await load(
  "decoder-16.21-macos/missile-controllers.json",
);
if ((await sha256(controllerBytes)) !== profile.missileControllersSha256)
  throw Error("Source initialization defaults changed");
const initialization = createLatestMissileInitialization(
  JSON.parse(new TextDecoder().decode(controllerBytes)),
);
for (const sample of native.cases.filter((row) =>
  row.rootOffsetControl.every((lane) => lane === 0),
)) {
  const record = report.missiles.find(
    (row) =>
      row.sequence === sample.sequence &&
      row.entityId === Number(sample.sourceEventId.split(":").at(-1)),
  );
  if (
    !record ||
    record.cast.ownerId !== sample.ownerId ||
    record.time !== sample.time
  )
    throw Error("Exact causal sampled missile input required");
  const hero = report.heroes.find(
      (row) => row.entityId === record.cast.ownerId,
    ),
    asset = scene.champions[`${hero.champion.toLowerCase()}/${hero.skinId}`];
  const rigSource = rigs.graphs[asset.animationGraph],
    resolvedBoneKeys = rigSource.joints.map((row) => row.resolvedBoneKey);
  const spells = await read(
      `${cache}/public/latest-scene/${asset.spellCatalog}`,
    ),
    spell = spells.spells[record.cast.spellHash],
    settings = initialization.settings(spell.data),
    sourceBoneName =
      spell.data.mMissileSpec.movementComponent.mStartBoneName ?? "";
  if (
    JSON.stringify(settings) !== JSON.stringify(sample.settings) ||
    sourceBoneName !== sample.sourceBoneName
  )
    throw Error("Exact native source spell start settings changed");
  if (
    JSON.stringify(resolvedBoneKeys) !==
      JSON.stringify(native.rigEmptyKey.resolvedBoneKeys) ||
    rigSource.rigFile !== native.rigEmptyKey.rigPath
  )
    throw Error("Native oracle and current installed source rig differ");
  const root = world.viewerRoot(record.cast.ownerId, record.time, {
    transportSequence: record.transportSequence,
    entryOrder: record.entryOrder ?? 0,
  });
  const result = initializeEmptyBoneCasterStart({
    record,
    settings,
    sourceBoneName,
    root,
    rig: {
      build: report.build,
      protocol: report.protocol,
      rigSha256: rigSource.rigSha256,
      resolvedBoneKeys,
    },
    terrain,
  });
  if (
    !result.resolved ||
    !root.position.every((lane, i) =>
      Object.is(lane, sample.suppliedWorldRoot[i]),
    ) ||
    !result.position.every((lane, i) => Object.is(lane, sample.position[i]))
  )
    throw Error("Current world root/translated original start differs");
  cases.push({
    sequence: record.sequence,
    sourceEventId: sample.sourceEventId,
    ownerId: record.cast.ownerId,
    root,
    result,
  });
  prepared.push({
    ...structuredClone(record),
    zeroReferenceSpec: { resolved: true },
    sourceBoneName,
    startInitialization: { settings },
  });
}
if (cases.length !== 3)
  throw Error("All three original zero-target-reference missiles required");
const sourceInputs = {
  report,
  scene,
  profile,
  world,
  terrain,
  records: prepared,
  load,
};
const owned = await createOwnedMissileCasterStarts(sourceInputs);
for (const row of prepared) {
  const result = owned.initialize(row),
    expected = cases.find((c) => c.sequence === row.sequence);
  if (
    !result.resolved ||
    !result.position.every((value, index) =>
      Object.is(value, expected.result.position[index]),
    ) ||
    result.sourceRig.rawRigAndCatalogVerified !== true
  )
    throw Error("Owned source caster agreement failed");
  expected.ownedResult = result;
}
const controls = [];
async function reject(label, run) {
  let rejected = false;
  try {
    await run();
  } catch {
    rejected = true;
  }
  if (!rejected) throw Error("Caster negative control accepted: " + label);
  controls.push({ label, rejected });
}
await reject("unowned-record-copy", () =>
  owned.initialize(structuredClone(prepared[0])),
);
const first = prepared[0],
  saved = first.cast.overrideFlag14d;
first.cast.overrideFlag14d = -0;
await reject("signed-zero-causal-mutation", () => owned.initialize(first));
first.cast.overrideFlag14d = saved;
let getterCalls = 0;
Object.defineProperty(first.cast, "overrideFlag14d", {
  configurable: true,
  enumerable: true,
  get() {
    getterCalls++;
    return saved;
  },
});
await reject("getter-causal-mutation", () => owned.initialize(first));
Object.defineProperty(first.cast, "overrideFlag14d", {
  configurable: true,
  enumerable: true,
  writable: true,
  value: saved,
});
if (getterCalls)
  throw Error("Caster causal validation invoked supplied getter");
for (const [label, mutate] of [
  [
    "forged-start-settings",
    (row) => (row.startInitialization.settings.castType = 3),
  ],
  ["forged-bone-name", (row) => (row.sourceBoneName = "Root")],
]) {
  const rows = structuredClone(prepared);
  mutate(rows[0]);
  await reject(label, () =>
    createOwnedMissileCasterStarts({ ...sourceInputs, records: rows }),
  );
}
await reject("corrupt-installed-rig-bytes", () =>
  createOwnedMissileCasterStarts({
    ...sourceInputs,
    load: async (path) => {
      const bytes = await load(path);
      if (!path.endsWith("model.skl")) return bytes;
      const altered = new Uint8Array(bytes);
      altered[altered.length - 1] ^= 1;
      return altered;
    },
  }),
);
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error("Caster world source changed: " + path);
const output = `${cache}/research/missile-caster-world-inputs-v33.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "current-world-caster-start-value-agreement",
      build: report.build,
      protocol: report.protocol,
      inputs,
      cases,
      controls,
      scope: {
        currentWorldProducerVerified: true,
        sourceBoundRawRigAndCatalogVerified: true,
        actualCreationCursorOwned: true,
        ownDataAndSignedZeroControls: true,
        exactFloat32RootAndStartAgreementWithSuppliedNativeFixture: true,
        ordinaryFamilyAdmissionChanged: false,
        nativeMatchRootRecovered: false,
        nativePlacementParity: null,
        browserAcceptance: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    cases: cases.length,
    inputs: Object.keys(inputs).length,
    mismatches: 0,
  }),
);
