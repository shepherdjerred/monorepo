import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createLatestExperienceReader,
  EXPERIENCE_SHA,
} from "../latest-experience.mjs";
import { createLatestReplayState } from "../latest-replay-state.mjs";
import { primaryResourcePresentation } from "../latest-champion-state.mjs";
import {
  createLatestInspection,
  inspectionPanelDrawing,
  inspectionPanelSvg,
  paintInspectionPanel,
  pickVisibleReplayEntity,
} from "../latest-inspection.mjs";
const [arg] = process.argv.slice(2);
if (!arg) throw Error("Usage: inspect-experience.mjs <cache>");
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
  };
const nativePath = `${cache}/research/experience-native.json`,
  native = await json(nativePath),
  report = await json(`${cache}/research/latest-semantics-experience.json`),
  baseline = await json(`${cache}/research/latest-semantics-world-state.json`),
  replication = await json(`${cache}/research/latest-replication-native.json`),
  profile = await json(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`),
  packageBytes = await raw(`${cache}/public/latest-experience/package.json`),
  reader = await createLatestExperienceReader(
    profile,
    image,
    packageBytes,
    await raw(`${cache}/public/latest-champion-state/package.json`),
  );
check(
  native.packageSha256 === EXPERIENCE_SHA &&
    report.experiencePackageSha256 === EXPERIENCE_SHA &&
    native.preparerSha256 ===
      sha(await raw(`${root}/tools/prepare-experience.py`)),
  "Stale native XP evidence",
);
for (const [p, h] of Object.entries(native.inputs))
  check(sha(await raw(p)) === h, "Native XP input changed");
for (const [name, h] of Object.entries(native.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === h,
    "Native XP helper changed",
  );
for (const b of native.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Original XP block changed",
  );
const packets = new Map(replication.records.map((p) => [p.key, p])),
  expected = [];
let byteChecks = 0;
for (const observed of native.records) {
  const record = packets.get(observed.packetKey).records[observed.recordIndex],
    decoded = reader.experience(record),
    group = decoded.groups.find((g) => g.group === 32);
  check(
    record.entityId === observed.entityId &&
      decoded.consumerBits.experience === observed.bits &&
      group.consumed === observed.consumed,
    "Native XP read/getter differs",
  );
  byteChecks += group.consumed;
  expected.push({
    entityId: observed.entityId,
    time: observed.time,
    experience: decoded.values.experience,
  });
}
check(
  expected.length === report.experienceUpdates.length &&
    byteChecks === native.counts.nativeBytes,
  "XP observations incomplete",
);
for (const [i, e] of expected.entries())
  check(
    Object.entries(e).every(([k, v]) => report.experienceUpdates[i][k] === v),
    "Worker XP update differs",
  );
let legacyChecks = 0;
for (const [key, value] of Object.entries(baseline)) {
  if (key === "summary")
    for (const [k, v] of Object.entries(value))
      check(report.summary[k] === v, `Legacy summary changed: ${k}`);
  else
    check(
      JSON.stringify(report[key]) === JSON.stringify(value),
      `Legacy report changed: ${key}`,
    );
  legacyChecks++;
}
const scene = await json(`${cache}/public/latest-scene/manifest.json`),
  resources = new Map();
for (const h of report.heroes) {
  const asset = scene.champions[`${h.champion.toLowerCase()}/${h.skinId}`],
    catalog = await json(`${cache}/public/latest-scene/${asset.spellCatalog}`);
  resources.set(
    h.entityId,
    primaryResourcePresentation(
      catalog,
      asset.characterRecords,
      report.primaryResourceDefaults,
    ),
  );
}
const state = createLatestReplayState(report, {
    entities: report.worldEntities,
    updates: report.worldStateUpdates,
  }),
  inspection = createLatestInspection(report, state, resources),
  times = [
    ...new Set([
      0,
      120,
      ...report.experienceUpdates.map((u) => u.time),
      ...report.lifecycle.flatMap((e) => [Math.max(0, e.time - 0.001), e.time]),
    ]),
  ].sort((a, b) => a - b),
  saved = new Map();
let snapshotChecks = 0,
  selectionChecks = 0,
  canvasChecks = 0;
check(inspection.sample(0) === null, "Inspection must start unselected");
for (const h of report.heroes) {
  inspection.select(h.entityId);
  selectionChecks++;
  const updates = expected
    .filter((u) => u.entityId === h.entityId)
    .sort((a, b) => a.time - b.time);
  let cursor = 0,
    xp = null;
  for (const t of times) {
    while (cursor < updates.length && updates[cursor].time <= t)
      xp = updates[cursor++].experience;
    const s = state.sampleEntity(h.entityId, t),
      model = inspection.sample(t);
    check(
      s.experience === xp &&
        model.experience === xp &&
        model.currentGold === s.currentGold &&
        model.currentHealth === s.currentHealth &&
        model.level === s.level,
      "Inspection sampled state differs",
    );
    saved.set(`${h.entityId}:${t}`, JSON.stringify(model));
    snapshotChecks++;
  }
  for (const t of [...times].reverse())
    check(
      JSON.stringify(inspection.sample(t)) === saved.get(`${h.entityId}:${t}`),
      "Reverse inspection seek differs",
    );
}
const cases = [];
for (const h of report.heroes)
  for (const t of [0, 60, 105]) {
    inspection.select(h.entityId);
    const model = inspection.sample(t),
      drawing = inspectionPanelDrawing(model),
      commands = [];
    const context = {
      clearRect(...args) {
        commands.push(["clear", ...args]);
      },
      fillRect(...args) {
        commands.push(["rect", ...args, this.fillStyle]);
      },
      fillText(...args) {
        commands.push(["text", ...args, this.fillStyle, this.textAlign]);
      },
    };
    paintInspectionPanel(context, drawing);
    check(
      commands.length === drawing.ops.length + 1 &&
        commands.slice(1).every((c, i) => c[0] === drawing.ops[i].kind),
      "Canvas panel did not execute drawing commands",
    );
    check(
      inspectionPanelSvg(drawing).includes("Inventory unavailable") &&
        model.inventoryStatus === "unavailable" &&
        model.experienceProgressStatus === "curve-unbound",
      "Unsupported inventory/XP gauge became fabricated values",
    );
    canvasChecks++;
    cases.push({ label: `${h.champion} at ${t}s`, model, drawing });
  }
let deathChecks = 0,
  worldSelectionChecks = 0;
for (const e of report.lifecycle.filter(
  (e) =>
    e.kind === "death-candidate" &&
    report.heroes.some((h) => h.entityId === e.entityId),
)) {
  inspection.select(e.entityId);
  const model = inspection.sample(e.time);
  check(
    model.status === "Dead" &&
      inspectionPanelDrawing(model).description.includes("Dead"),
    "Inspection lost selected death state",
  );
  deathChecks++;
}
for (const e of report.worldEntities) {
  inspection.select(e.entityId);
  const model = inspection.sample(120),
    s = state.sampleEntity(e.entityId, 120);
  check(
    model.currentHealth === s.currentHealth &&
      model.experience === null &&
      model.currentGold === null,
    "World selection inherited champion stats",
  );
  if (e.creationTime > 0)
    check(
      inspection.sample(e.creationTime - 0.001).status === "Not spawned",
      "Selected future minion leaks spawn state",
    );
  worldSelectionChecks++;
}
const minion = report.worldEntities.find(
    (e) => e.entityClass === "lane-minion",
  ),
  death = report.lifecycle.find(
    (e) => e.entityId === minion.entityId && e.kind === "death-candidate",
  ),
  tower = report.worldEntities.find((e) => e.entityClass === "turret");
for (const [label, e, t] of [
  ["Tower", tower, 0],
  ["Minion before spawn", minion, minion.creationTime - 0.001],
  ["Minion in combat", minion, 70],
  ["Minion after death", minion, death.time],
]) {
  inspection.select(e.entityId);
  const model = inspection.sample(t);
  cases.push({ label, model, drawing: inspectionPanelDrawing(model) });
}
inspection.clear();
check(inspection.sample(60) === null, "Clearing selection left a panel");
selectionChecks++;
const THREE = await import(
    pathToFileURL(`${cache}/public/vendor/three.module.js`).href
  ),
  camera = new THREE.PerspectiveCamera(45, 1, 1, 2000),
  raycaster = new THREE.Raycaster(),
  rootGroup = new THREE.Group(),
  groups = [];
camera.position.set(0, 0, 500);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();
for (const [id, z] of [
  [1, 0],
  [2, -200],
]) {
  const g = new THREE.Group(),
    mesh = new THREE.Mesh(
      new THREE.BoxGeometry(100, 100, 100),
      new THREE.MeshBasicMaterial(),
    );
  g.userData.replayEntityId = id;
  g.position.z = z;
  g.add(mesh);
  rootGroup.add(g);
  groups.push(g);
}
const pick = () => {
  rootGroup.updateMatrixWorld(true);
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  return pickVisibleReplayEntity(
    raycaster.intersectObjects(groups, true),
    new Set([1, 2]),
  );
};
let pickingChecks = 0;
check(pick() === 1, "Nearest visible actor not picked");
pickingChecks++;
groups[0].visible = false;
check(pick() === 2, "Hidden ancestor picked");
pickingChecks++;
groups[0].visible = true;
groups[0].children[0].visible = false;
check(pick() === 2, "Hidden submesh picked");
pickingChecks++;
groups[0].children[0].visible = true;
groups[0].children[0].material.visible = false;
check(pick() === 2, "Hidden material picked");
pickingChecks++;
rootGroup.visible = false;
check(pick() === null, "Hidden world picked");
pickingChecks++;
for (const g of groups) {
  g.children[0].geometry.dispose();
  g.children[0].material.dispose();
}
let rejectionChecks = 0;
for (const fn of [
  () => inspection.select(0),
  () => createLatestReplayState({ ...report, experiencePackageSha256: "bad" }),
  () =>
    createLatestReplayState({
      ...report,
      experienceUpdates: [{ ...report.experienceUpdates[0], entityId: 0 }],
    }),
  () =>
    reader.experience({
      groups: [{ group: 32, mask: 1 << 11, dataHex: "fe00" }],
    }),
  () => createLatestInspection(report, state, new Map()),
  () => state.sampleEntity(report.heroes[0].entityId, 121),
]) {
  let rejected = false;
  try {
    fn();
  } catch {
    rejected = true;
  }
  check(rejected, "Invalid inspection/XP input accepted");
  rejectionChecks++;
}
const sources = {};
for (const name of [
  "latest-experience.mjs",
  "latest-inspection.mjs",
  "latest-state-fields.mjs",
  "latest-champion-state.mjs",
  "latest-replay-state.mjs",
  "latest-reconstruction.mjs",
  "latest-viewer.mjs",
  "structural-check-worker.mjs",
  "latest.html",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const counts = {
  nativeExperienceGroups: native.records.length,
  byteChecks,
  getterChecks: native.records.length,
  updates: report.experienceUpdates.length,
  snapshotChecks,
  reverseSeekChecks: snapshotChecks,
  selectionChecks,
  worldSelectionChecks,
  deathChecks,
  canvasChecks,
  pickingChecks,
  legacyChecks,
  rejectionChecks,
};
await Bun.write(
  `${cache}/research/experience-comparison.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "experience-and-inspection-comparison",
      packageSha256: sha(packageBytes),
      nativeEvidenceSha256: inputs[nativePath],
      inspectorSha256: sha(await raw(import.meta.path)),
      inputs,
      sources,
      counts,
      cases,
      scope: {
        nativeExperienceGetterExecuted: true,
        mainViewerSourceIntegrated: true,
        canvasCommandsExecuted: true,
        threeRaycastExecuted: true,
        browserRun: false,
        leagueAvCompared: false,
        inventoryDecoded: false,
        combatStatsDecoded: false,
        experienceCurveSelectionVerified: false,
      },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(counts));
