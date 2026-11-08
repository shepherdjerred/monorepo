// Causal selected-world inputs for original named source starts, cast type 1.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { loadLatestStaticCatalogSelection } from "../latest-static-catalog.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { loadLatestInitialResourcePrefix } from "../latest-initial-resource-prefix.mjs";
import { loadLatestViewerPoseAssets } from "../latest-viewer-pose-assets.mjs";
import { createLatestWorldPresentation } from "../latest-world-presentation.mjs";
import { createLatestAnimationRigBindings } from "../latest-animation-rigs.mjs";
import { createLatestMissileInitialization } from "../latest-missile-initialization.mjs";
import { createOwnedNamedBoneTypeOneMissileCasterStarts } from "../latest-missile-caster-context.mjs";
import { sameDirectCompiledData } from "../latest-direct-compiled-restore.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-lineup-5667809143"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error("Caster input changed: " + path);
  inputs[path] = digest;
  return bytes;
}
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
const read = async (path) => decode(await raw(path));
const load = (path) => raw(`${cache}/public/${path}`);
await captureDirectSourceInputs([import.meta.path], raw);
const capture = await read(
  `${cache}/research/direct-session-selected-control-playback.json`,
);
const reportBytes = await raw(capture.decodedReport.path);
if ((await sha256(reportBytes)) !== capture.decodedReport.sha256)
  throw Error("Actual captured replay report changed");
const report = decode(reportBytes),
  selected = await loadLatestStaticCatalogSelection({ load }),
  profile = selected.profile(),
  scene = decode(await selected.readRole("scene"));
if (
  report.endTime !== 99 ||
  report.build !== "16.21.829.8620" ||
  report.protocol !== "20e09df23c66b85e"
)
  throw Error("Exact bounded replay required");
const get = (path) => selected.read(path),
  heights = await get("latest-scene/heights.bin"),
  terrain = createLatestTerrain(
    scene,
    new Float32Array(
      heights.buffer,
      heights.byteOffset,
      heights.byteLength / 4,
    ),
  );
const initial = await loadLatestInitialResourcePrefix({
  profile,
  report,
  manifestBytes: await selected.readRole("effects"),
  load: get,
  staticCatalog: selected,
});
const viewerPoseAssets = await loadLatestViewerPoseAssets({
  profile,
  report,
  scene,
  load: get,
  staticCatalog: selected,
});
const world = createLatestWorldPresentation({
  report,
  scene,
  terrain,
  initialResourcePrefix: initial.policy,
  viewerPoseAssets,
});
const rigBytes = await get("decoder-16.21-macos/animation-rigs.json"),
  rigs = decode(rigBytes),
  rigFactory = await createLatestAnimationRigBindings(profile, rigBytes),
  controllerBytes = await get("decoder-16.21-macos/missile-controllers.json");
if ((await sha256(controllerBytes)) !== profile.missileControllersSha256)
  throw Error("Caster defaults changed");
const initialization = createLatestMissileInitialization(
    decode(controllerBytes),
  ),
  cases = [];
for (const record of report.missiles) {
  if (record.time < 69 || record.time > 99) continue;
  const hero = report.heroes.find(
    (hero) => hero.entityId === record.cast.ownerId,
  );
  if (
    !hero ||
    record.cast.sourceName.toLowerCase() !== hero.champion.toLowerCase()
  )
    continue;
  const actorKey = `${hero.champion.toLowerCase()}/${hero.skinId}`,
    asset = scene.champions[actorKey],
    catalog = decode(await get(`latest-scene/${asset.spellCatalog}`)),
    spell = catalog.spells[record.cast.spellHash],
    movement = spell?.data.mMissileSpec?.movementComponent;
  if (
    movement?.__type !== "FixedSpeedMovement" ||
    spell.data.mCastType !== 1 ||
    typeof movement.mStartBoneName !== "string" ||
    !movement.mStartBoneName.length ||
    (movement.mTargetBoneName ?? "") !== "" ||
    (movement.mTracksTarget ?? true) !== true ||
    record.cast.targetCount !== 1 ||
    record.cast.forceRecordedSourcePosition
  )
    continue;
  const sourceBoneName = movement.mStartBoneName,
    settings = initialization.settings(spell.data),
    rig = rigs.graphs[asset.animationGraph],
    installed = await rigFactory.bind(
      asset.animationGraph,
      await get(`latest-scene/${rig.rigFile}`),
      await get(`latest-scene/${rig.catalogFile}`),
    ),
    binding = installed.resolve(sourceBoneName);
  if (
    binding.status !== "rig-joint" ||
    settings.particleStartOffset.some((lane) => lane !== 0) ||
    record.cast.overrideFlag14d !== 0
  )
    throw Error("Unproven named source branch in actual candidate inventory");
  const cursor = {
      transportSequence: record.transportSequence,
      entryOrder: record.entryOrder ?? 0,
    },
    root = world.viewerRoot(record.cast.ownerId, record.time, cursor),
    pose = world.viewerPose(
      record.cast.ownerId,
      [binding.resolvedBoneKey],
      record.time,
      cursor,
    );
  cases.push({
    sequence: record.sequence,
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
    pose,
  });
}
if (!cases.length) throw Error("No actual named cast-type-one candidates");
const records = cases.map((row) => structuredClone(row.record)),
  providerOptions = {
    report,
    scene,
    profile,
    world,
    terrain,
    records,
    load: get,
  },
  provider =
    await createOwnedNamedBoneTypeOneMissileCasterStarts(providerOptions),
  providerResults = records.map((record) => ({
    sequence: record.sequence,
    start: provider.initialize(record),
  }));
if (
  !sameDirectCompiledData(
    providerResults
      .filter((row) => row.start.resolved)
      .map((row) => row.sequence),
    cases.filter((row) => row.pose.resolved).map((row) => row.sequence),
  )
)
  throw Error("Owned type1 source changed the actual unresolved-pose frontier");
const negativeControls = [];
async function reject(label, action) {
  let error;
  try {
    await action();
  } catch (caught) {
    error = caught.message;
  }
  if (!error) throw Error("Named type1 provider must reject " + label);
  negativeControls.push({ label, rejected: true, error });
}
await reject("foreign-record-identity", () =>
  provider.initialize(structuredClone(records[0])),
);
const order = Object.getOwnPropertyDescriptor(records[0], "entryOrder");
records[0].entryOrder = -0;
await reject("signed-zero-cursor-mutation", () =>
  provider.initialize(records[0]),
);
if (order) Object.defineProperty(records[0], "entryOrder", order);
else delete records[0].entryOrder;
let getters = 0;
const sourcePosition = records[0].cast.sourcePosition;
Object.defineProperty(records[0].cast, "sourcePosition", {
  configurable: true,
  enumerable: true,
  get() {
    getters++;
    return sourcePosition;
  },
});
await reject("accessor-causal-mutation", () => provider.initialize(records[0]));
Object.defineProperty(records[0].cast, "sourcePosition", {
  configurable: true,
  enumerable: true,
  writable: true,
  value: sourcePosition,
});
if (getters) throw Error("Provider executed an untrusted getter");
await reject("forged-record-source-name", () =>
  createOwnedNamedBoneTypeOneMissileCasterStarts({
    ...providerOptions,
    records: [{ ...structuredClone(records[0]), sourceBoneName: "Invented" }],
  }),
);
await reject("raw-installed-rig-mutation", () =>
  createOwnedNamedBoneTypeOneMissileCasterStarts({
    ...providerOptions,
    load: async (path) => {
      const bytes = await get(path);
      if (path !== `latest-scene/${cases[0].rig.rigFile}`) return bytes;
      const changed = bytes.slice();
      changed[0] ^= 1;
      return changed;
    },
  }),
);
const wrongCursor = await createOwnedNamedBoneTypeOneMissileCasterStarts({
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
if (wrongCursor.initialize(records[0]).resolved)
  throw Error("Foreign causal pose admitted");
negativeControls.push({ label: "foreign-causal-pose", unresolved: true });
const isolated = provider.initialize(records[0]);
isolated.sourcePose.attachments[0].position[0]++;
if (
  !sameDirectCompiledData(
    provider.initialize(records[0]),
    providerResults[0].start,
  )
)
  throw Error("Mutable output escaped owned provider");
negativeControls.push({ label: "output-clone-isolation", isolated: true });
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error("Caster source changed: " + path);
const output = `${cache}/research/named-bone-type1-caster-inputs-v37.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "current-causal-named-bone-type1-caster-inputs",
      build: report.build,
      protocol: report.protocol,
      inputs,
      cases,
      providerResults,
      negativeControls,
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
    resolved: cases
      .filter((row) => row.pose.resolved)
      .map((row) => row.sequence),
    omitted: cases
      .filter((row) => !row.pose.resolved)
      .map((row) => ({ sequence: row.sequence, reasons: row.pose.reasons })),
    pins: Object.keys(inputs).length,
  }),
);
