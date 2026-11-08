// Actual causal pose inputs for a bounded original named-bone start oracle.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { loadLatestInitialResourcePrefix } from "../latest-initial-resource-prefix.mjs";
import { loadLatestViewerPoseAssets } from "../latest-viewer-pose-assets.mjs";
import { createLatestWorldPresentation } from "../latest-world-presentation.mjs";
import { createLatestAnimationRigBindings } from "../latest-animation-rigs.mjs";
import { createLatestMissileInitialization } from "../latest-missile-initialization.mjs";
import { createOwnedNamedBoneMissileCasterStarts } from "../latest-missile-caster-context.mjs";
import { sameDirectCompiledData } from "../latest-direct-compiled-restore.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Named-bone input changed");
  inputs[path] = hash;
  return bytes;
}
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
const read = async (path) => decode(await raw(path));
const load = (path) => raw(`${cache}/public/${path}`);
await captureDirectSourceInputs([import.meta.path], raw);
const exported = await read(
  `${cache}/research/viewer-root-reconstruction.json`,
);
if (
  exported.kind !== "verified-ordinary-reconstruction-diagnostic-export" ||
  exported.runtimePlaybackInput !== false
)
  throw Error("Current ordinary diagnostic required");
for (const [path, hash] of Object.entries(exported.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error("Current ordinary source changed: " + path);
if (
  (await sha256(await raw(exported.controlReportPath))) !==
  exported.controlReportSha256
)
  throw Error("Ordinary control bytes changed");
const report = exported.report,
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  scene = await read(`${cache}/public/latest-scene/manifest.json`);
if (
  report.endTime !== 99 ||
  report.build !== "16.21.829.8620" ||
  report.protocol !== "20e09df23c66b85e"
)
  throw Error("Exact current99 world required");
const height = await load("latest-scene/heights.bin"),
  terrain = createLatestTerrain(
    scene,
    new Float32Array(height.buffer, height.byteOffset, height.byteLength / 4),
  );
const manifestBytes = await load("latest-effects/manifest.json");
const initial = await loadLatestInitialResourcePrefix({
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
const rigBytes = await load("decoder-16.21-macos/animation-rigs.json"),
  rigs = decode(rigBytes),
  rigFactory = await createLatestAnimationRigBindings(profile, rigBytes);
const controllerBytes = await load(
  "decoder-16.21-macos/missile-controllers.json",
);
if ((await sha256(controllerBytes)) !== profile.missileControllersSha256)
  throw Error("Source start defaults changed");
const initialization = createLatestMissileInitialization(
  decode(controllerBytes),
);
const cases = [];
for (const sequence of [2843, 3676, 4141, 4313]) {
  const record = report.missiles.find((row) => row.sequence === sequence);
  if (!record) throw Error("Expected actual named-bone candidate missing");
  const hero = report.heroes.find(
      (hero) => hero.entityId === record.cast.ownerId,
    ),
    actorKey = `${hero.champion.toLowerCase()}/${hero.skinId}`,
    asset = scene.champions[actorKey];
  const catalog = await read(
      `${cache}/public/latest-scene/${asset.spellCatalog}`,
    ),
    spell = catalog.spells[record.cast.spellHash],
    movement = spell.data.mMissileSpec.movementComponent;
  const sourceBoneName = movement.mStartBoneName ?? "",
    settings = initialization.settings(spell.data),
    rig = rigs.graphs[asset.animationGraph];
  const installed = await rigFactory.bind(
    asset.animationGraph,
    await load(`latest-scene/${rig.rigFile}`),
    await load(`latest-scene/${rig.catalogFile}`),
  );
  const binding = installed.resolve(sourceBoneName);
  if (binding.status !== "rig-joint")
    throw Error("Actual source named bone is not installed");
  const cursor = {
    transportSequence: record.transportSequence,
    entryOrder: record.entryOrder ?? 0,
  };
  const root = world.viewerRoot(record.cast.ownerId, record.time, cursor),
    entity = world.entity(record.cast.ownerId, record.time, cursor),
    pose = world.viewerPose(
      record.cast.ownerId,
      [binding.resolvedBoneKey],
      record.time,
      cursor,
    );
  if (
    settings.castType !== 3 ||
    settings.particleStartOffset.some((lane) => lane !== 0) ||
    record.cast.overrideFlag14d !== 0 ||
    record.cast.forceRecordedSourcePosition
  )
    throw Error("Exact zero-offset nonforced type3 fixture required");
  cases.push({
    sequence,
    sourceEventId: `packet:${record.transportSequence}:entry:${record.entryOrder ?? 0}:missile:${record.entityId}`,
    record,
    actorKey,
    sourceBoneName,
    settings,
    rig: {
      graphFile: asset.animationGraph,
      rigFile: rig.rigFile,
      rigSha256: rig.rigSha256,
      catalogFile: rig.catalogFile,
      catalogSha256: rig.catalogSha256,
      binding,
    },
    root,
    entityDirection: entity.direction,
    pose,
  });
}
const resolved = cases
  .filter((row) => row.pose.resolved)
  .map((row) => row.sequence);
if (JSON.stringify(resolved) !== JSON.stringify([3676, 4313]))
  throw Error(
    "Named-bone actual-pose frontier changed; review before new admission",
  );
const records = cases.map((row) => structuredClone(row.record)),
  providerOptions = { report, scene, profile, world, terrain, records, load },
  provider = await createOwnedNamedBoneMissileCasterStarts(providerOptions);
const providerResults = records.map((record) => ({
  sequence: record.sequence,
  start: provider.initialize(record),
}));
if (
  !sameDirectCompiledData(
    providerResults
      .filter((row) => row.start.resolved)
      .map((row) => row.sequence),
    resolved,
  )
)
  throw Error("Owned named provider changed the actual missing-pose frontier");
const negativeControls = [];
async function reject(label, action) {
  let error;
  try {
    await action();
  } catch (caught) {
    error = caught.message;
  }
  if (!error) throw Error(`Named provider must reject ${label}`);
  negativeControls.push({ label, rejected: true, error });
}
await reject("foreign-record-identity", () =>
  provider.initialize(structuredClone(records[1])),
);
const order = Object.getOwnPropertyDescriptor(records[1], "entryOrder");
records[1].entryOrder = -0;
await reject("signed-zero-causal-mutation", () =>
  provider.initialize(records[1]),
);
if (order) Object.defineProperty(records[1], "entryOrder", order);
else delete records[1].entryOrder;
let getterCalls = 0;
const sourcePosition = records[1].cast.sourcePosition;
Object.defineProperty(records[1].cast, "sourcePosition", {
  configurable: true,
  enumerable: true,
  get() {
    getterCalls++;
    return sourcePosition;
  },
});
await reject("accessor-causal-mutation", () => provider.initialize(records[1]));
Object.defineProperty(records[1].cast, "sourcePosition", {
  configurable: true,
  enumerable: true,
  writable: true,
  value: sourcePosition,
});
if (getterCalls !== 0)
  throw Error("Named provider invoked an untrusted getter");
await reject("forged-prepared-source-name", () =>
  createOwnedNamedBoneMissileCasterStarts({
    ...providerOptions,
    records: [{ ...structuredClone(records[1]), sourceBoneName: "Invented" }],
  }),
);
await reject("raw-installed-rig-byte-mutation", () =>
  createOwnedNamedBoneMissileCasterStarts({
    ...providerOptions,
    load: async (path) => {
      const bytes = await load(path);
      if (!path.endsWith("akshan/20/model.skl")) return bytes;
      const changed = bytes.slice();
      changed[0] ^= 1;
      return changed;
    },
  }),
);
const foreignCursorProvider = await createOwnedNamedBoneMissileCasterStarts({
  ...providerOptions,
  world: {
    viewerRoot: (...args) => world.viewerRoot(...args),
    viewerPose: (...args) => {
      const pose = world.viewerPose(...args);
      if (pose.resolved) pose.poseEvidence.cursor.transportSequence++;
      return pose;
    },
  },
});
if (foreignCursorProvider.initialize(records[1]).resolved)
  throw Error("Named provider accepted a foreign causal pose");
negativeControls.push({ label: "foreign-pose-cursor", unresolved: true });
const isolated = provider.initialize(records[1]);
isolated.sourceRig.rigSha256 = "0".repeat(64);
isolated.sourcePose.attachments[0].position[0]++;
if (
  !sameDirectCompiledData(
    provider.initialize(records[1]),
    providerResults[1].start,
  )
)
  throw Error("Caller mutation escaped named provider output isolation");
negativeControls.push({ label: "output-clone-isolation", isolated: true });
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error("Named-bone capture source changed");
const output = `${cache}/research/named-bone-caster-inputs-v35.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "current-causal-named-bone-caster-inputs",
      build: report.build,
      protocol: report.protocol,
      inputs,
      cases,
      providerResults,
      negativeControls,
      providerScope: provider.scope,
      scope: {
        actualSharedWorldAndPoseQueries: true,
        sourceBoundInstalledRig: true,
        sourcePoseSuppliedToNativeOracle: true,
        nativeMatchPoseRecovered: false,
        nativeLiveModelReady: false,
        activeFamilyAdmission: false,
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
    resolved,
    omitted: cases
      .filter((row) => !row.pose.resolved)
      .map((row) => ({ sequence: row.sequence, reasons: row.pose.reasons })),
    pins: Object.keys(inputs).length,
    negativeControls: negativeControls.length,
  }),
);
