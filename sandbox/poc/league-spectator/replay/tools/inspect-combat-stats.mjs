import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  createLatestCombatStatReader,
  deriveLatestCombatStats,
  combatStatRows,
  COMBAT_STATS_SHA,
  COMBAT_STAT_FIELDS,
} from "../latest-combat-stats.mjs";
import { createLatestReplayState } from "../latest-replay-state.mjs";
import { primaryResourcePresentation } from "../latest-champion-state.mjs";
import { createLatestItemAssets } from "../latest-item-assets.mjs";
import {
  createLatestInspection,
  inspectionPanelDrawing,
  paintInspectionPanel,
} from "../latest-inspection.mjs";

const [arg] = process.argv.slice(2);
if (!arg) throw Error("Usage: inspect-combat-stats.mjs <cache>");
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
  view = new DataView(new ArrayBuffer(4)),
  bits = (v) => {
    view.setFloat32(0, v, true);
    return view.getUint32(0, true);
  },
  number = (v) => {
    view.setUint32(0, v, true);
    return view.getFloat32(0, true);
  },
  nativePath = `${cache}/research/combat-stats-native.json`,
  native = await json(nativePath),
  report = await json(`${cache}/research/latest-semantics-combat-stats.json`),
  baseline = await json(
    `${cache}/research/latest-semantics-corpse-policy.json`,
  ),
  profile = await json(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`),
  championBytes = await raw(
    `${cache}/public/latest-champion-state/package.json`,
  ),
  packageBytes = await raw(`${cache}/public/latest-combat-stats/package.json`),
  reader = await createLatestCombatStatReader(
    profile,
    image,
    championBytes,
    packageBytes,
  ),
  meta = reader.metadata,
  schema = JSON.parse(new TextDecoder().decode(championBytes)),
  packets = await json(`${cache}/research/latest-replication-input.json`),
  records = new Map(
    report.replicationRecords.map((r) => [
      `${r.chunkId}:${r.blockOffset}:${r.recordIndex}`,
      r,
    ]),
  );
check(
  native.packageSha256 === COMBAT_STATS_SHA &&
    report.combatStatPackageSha256 === COMBAT_STATS_SHA,
  "Combat package differs",
);
check(
  native.preparerSha256 ===
    sha(await raw(`${root}/tools/prepare-combat-stats.py`)),
  "Combat preparer changed",
);
for (const [p, h] of Object.entries(native.inputs))
  check(sha(await raw(p)) === h, "Native combat input changed");
for (const [name, h] of Object.entries(native.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === h,
    "Native combat helper changed",
  );
for (const b of native.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Native combat instruction changed",
  );
same(meta.groups, schema.groups, "Combat registration differs");
let bindingChecks = 0,
  namedApiChecks = 0,
  probeScalarChecks = 0,
  groupChecks = 0,
  byteChecks = 0,
  inputChecks = 0,
  scalarChecks = 0,
  legacyChecks = 0;
for (const [name, field] of Object.entries(meta.fields)) {
  const g = schema.groups[field.group];
  check(
    name === `field_${field.offset.toString(16)}` &&
      g.offsets[field.index] === field.offset &&
      (g.floatMask >>> field.index) & 1 &&
      native.mapping[field.cacheOffset].sourceOffset === field.offset,
    "Stat raw/cache binding differs",
  );
  bindingChecks++;
}
for (const [name, spec] of Object.entries(meta.stats)) {
  check(
    new TextDecoder().decode(
      image.subarray(
        spec.apiNameStringRva,
        spec.apiNameStringRva + name.length + 1,
      ),
    ) === `${name}\0`,
    "Native API name differs",
  );
  check(
    spec.cacheOffsets.length === spec.inputFields.length &&
      spec.inputFields.every(
        (f, i) => meta.fields[f].cacheOffset === spec.cacheOffsets[i],
      ),
    "Stat formula inputs differ",
  );
  namedApiChecks++;
}
for (const p of native.probes) {
  const actual = deriveLatestCombatStats(p.input, meta);
  for (const [name, want] of Object.entries(p.bits)) {
    check(bits(actual[name]) === want, `Diagnostic scalar differs: ${name}`);
    probeScalarChecks++;
  }
}
const known = new Map(),
  expectedUpdates = [],
  nativeTracks = new Map();
for (const n of native.records) {
  const packet = packets.packets[n.packetKey],
    r = records.get(`${packet.chunkId}:${packet.blockOffset}:${n.recordIndex}`);
  check(
    r && r.entityId === n.entityId && r.time === n.time,
    "Combat record provenance differs",
  );
  const decoded = reader.read(r);
  same(decoded.consumerBits, n.inputBits, "Native stat wire input differs");
  same(
    decoded.groups.map(({ group, mask, consumed }) => ({
      group,
      mask,
      consumed,
    })),
    n.groups,
    "Native stat group consumption differs",
  );
  groupChecks += n.groups.length;
  byteChecks += n.groups.reduce((s, g) => s + g.consumed, 0);
  inputChecks += Object.keys(n.inputBits).length;
  const input = { ...known.get(n.entityId), ...decoded.values };
  known.set(n.entityId, input);
  const actual = deriveLatestCombatStats(input, meta);
  same(
    Object.keys(actual).sort(),
    Object.keys(n.statBits).sort(),
    "Unknown stat dependencies fabricated",
  );
  for (const [name, want] of Object.entries(n.statBits)) {
    check(bits(actual[name]) === want, `Recorded scalar differs: ${name}`);
    scalarChecks++;
  }
  const values = Object.fromEntries(
    Object.entries(n.statBits)
      .filter(([name]) =>
        meta.stats[name].inputFields.some((key) =>
          Object.hasOwn(n.inputBits, key),
        ),
      )
      .map(([name, value]) => [name, number(value)]),
  );
  if (Object.keys(values).length)
    expectedUpdates.push({
      entityId: r.entityId,
      ...values,
      time: r.time,
      transportSequence: r.transportSequence,
      recordIndex: r.recordIndex,
      stateSequence: expectedUpdates.length,
      chunkId: r.chunkId,
      blockOffset: r.blockOffset,
      stream: r.stream,
    });
  if (!nativeTracks.has(n.entityId)) nativeTracks.set(n.entityId, []);
  nativeTracks.get(n.entityId).push(n);
}
same(
  reader.reconstruct(
    report.replicationRecords,
    report.heroes.map((h) => h.entityId),
    report.endTime,
  ),
  expectedUpdates,
  "Native-derived sparse updates differ",
);
same(report.combatStatUpdates, expectedUpdates, "Worker stat output differs");
for (const [key, value] of Object.entries(baseline)) {
  same(
    report[key],
    key === "summary"
      ? { ...value, combatStatUpdates: expectedUpdates.length }
      : value,
    `Prior reconstruction changed: ${key}`,
  );
  legacyChecks++;
}
const state = createLatestReplayState(report, {
    entities: report.worldEntities,
    updates: report.worldStateUpdates,
  }),
  scene = await json(`${cache}/public/latest-scene/manifest.json`),
  resources = new Map(),
  itemAssets = await createLatestItemAssets(
    report,
    await raw(`${cache}/public/latest-items/package.json`),
  );
for (const h of report.heroes) {
  const a = scene.champions[`${h.champion.toLowerCase()}/${h.skinId}`];
  resources.set(
    h.entityId,
    primaryResourcePresentation(
      await json(`${cache}/public/latest-scene/${a.spellCatalog}`),
      a.characterRecords,
      report.primaryResourceDefaults,
    ),
  );
}
const inspection = createLatestInspection(report, state, resources, itemAssets),
  times = [
    ...new Set([
      0,
      report.endTime,
      ...report.combatStatUpdates.flatMap((u) => [
        Math.max(0, u.time - 0.001),
        u.time,
      ]),
      ...report.lifecycle
        .filter((e) => e.kind === "hero-death")
        .map((e) => e.time),
    ]),
  ].sort((a, b) => a - b),
  saved = new Map();
let snapshotChecks = 0,
  reverseSeekChecks = 0,
  canvasChecks = 0,
  worldChecks = 0,
  deathChecks = 0;
const observedItems = new Set(),
  images = new Map();
for (const h of report.heroes) {
  inspection.select(h.entityId);
  for (const t of times) {
    const sample = state.sampleEntity(h.entityId, t),
      last = nativeTracks.get(h.entityId).findLast((n) => n.time <= t),
      expected = Object.fromEntries(
        COMBAT_STAT_FIELDS.map((name) => [
          name,
          Object.hasOwn(last?.statBits ?? {}, name)
            ? number(last.statBits[name])
            : null,
        ]),
      );
    same(
      sample.combatStats.values,
      expected,
      "Timeline scalar differs from latest native record",
    );
    check(
      sample.combatStats.status === "observed",
      "Initial combat stats missing",
    );
    for (const [name, source] of Object.entries(sample.combatStats.sources)) {
      const update = expectedUpdates.findLast(
        (u) =>
          u.entityId === h.entityId && u.time <= t && Object.hasOwn(u, name),
      );
      same(
        source,
        {
          time: update.time,
          transportSequence: update.transportSequence,
          recordIndex: update.recordIndex,
          stateSequence: update.stateSequence,
        },
        "Stat source provenance differs",
      );
    }
    const model = inspection.sample(t),
      drawing = inspectionPanelDrawing(model),
      commands = [];
    for (const row of model.inventoryItems)
      if (row.item) {
        const a = row.item.presentation;
        observedItems.add(a.id);
        images.set(a.iconSha256, { key: a.iconSha256 });
      }
    paintInspectionPanel(
      {
        clearRect() {
          commands.push("clear");
        },
        fillRect() {
          commands.push("rect");
        },
        fillText() {
          commands.push("text");
        },
        drawImage(image) {
          check(images.has(image.key), "Unowned stat-panel icon");
          commands.push("image");
        },
      },
      drawing,
      images,
    );
    same(
      commands,
      ["clear", ...drawing.ops.map((o) => o.kind)],
      "Stat panel canvas command sequence differs",
    );
    for (const row of model.combatStats)
      check(
        drawing.ops.some((o) => o.kind === "text" && o.value === row.label) &&
          drawing.description.includes(`${row.label} ${row.formatted}`),
        "Panel stat absent",
      );
    check(
      model.combatStats.length === 8 &&
        model.additionalCombatStats.length === 16,
      "Panel stat coverage incomplete",
    );
    if (sample.dead) {
      check(model.status === "Dead", "Stats resurrected champion");
      deathChecks++;
    }
    saved.set(`${h.entityId}:${t}`, JSON.stringify(model));
    snapshotChecks++;
    canvasChecks++;
  }
  for (const t of [...times].reverse()) {
    check(
      JSON.stringify(inspection.sample(t)) === saved.get(`${h.entityId}:${t}`),
      "Reverse stat seek differs",
    );
    reverseSeekChecks++;
  }
}
for (const e of report.worldEntities) {
  inspection.select(e.entityId);
  const s = state.sampleEntity(e.entityId, report.endTime);
  check(
    s.combatStats.status === "unavailable" &&
      Object.values(s.combatStats.values).every((v) => v === null) &&
      Object.keys(s.combatStats.sources).length === 0 &&
      inspection.sample(report.endTime).combatStatsStatus === "unavailable",
    "World inherited champion stats",
  );
  worldChecks++;
}
// Exercise partial initialization separately: an AD output requires every input.
const encode = (name, value, time, sequence) => {
    const field = meta.fields[name],
      bytes = Buffer.alloc(4);
    bytes.writeFloatLE(value);
    return {
      entityId: report.heroes[0].entityId,
      time,
      transportSequence: sequence,
      recordIndex: 0,
      chunkId: 0,
      blockOffset: sequence,
      stream: 1,
      groups: [
        {
          group: field.group,
          mask: (1 << field.index) >>> 0,
          dataHex: (bytes[0] >= 254 ? "fe" : "") + bytes.toString("hex"),
        },
      ],
    };
  },
  deps = meta.stats.attackDamage.inputFields,
  partial = deps.map((name, i) => encode(name, i + 1, i === 0 ? 0 : 1, i));
check(
  !reader
    .reconstruct(
      partial,
      report.heroes.map((h) => h.entityId),
      report.endTime,
    )
    .some((u) => u.time === 0 && Object.hasOwn(u, "attackDamage")),
  "Missing AD input filled from future",
);
check(
  reader
    .reconstruct(
      partial,
      report.heroes.map((h) => h.entityId),
      report.endTime,
    )
    .at(-1).attackDamage !== undefined,
  "Completed AD dependencies unavailable",
);
const legacy = createLatestReplayState(baseline);
check(
  legacy.sampleEntity(report.heroes[0].entityId, 0).combatStats.status ===
    "unavailable",
  "Legacy stats fabricated",
);
const auxiliary = combatStatRows(
    { armorPenetrationPercent: 1, critDamage: 200 },
    false,
  ),
  primary = combatStatRows({ critChance: 0.25 });
check(
  auxiliary.find((r) => r.name === "armorPenetrationPercent").formatted ===
    "1" &&
    auxiliary.find((r) => r.name === "critDamage").formatted === "200%" &&
    primary.find((r) => r.name === "critChance").formatted === "25%",
  "Native scalar display units changed",
);
let rejectionChecks = 0;
for (const fn of [
  () =>
    createLatestCombatStatReader(
      { ...profile, clientVersion: "other" },
      image,
      championBytes,
      packageBytes,
    ),
  () =>
    createLatestCombatStatReader(
      profile,
      image,
      championBytes,
      new Uint8Array([0]),
    ),
  () =>
    createLatestCombatStatReader(
      profile,
      image,
      new Uint8Array([0]),
      packageBytes,
    ),
  () => {
    const bad = image.slice();
    bad[meta.sourceBlocks[0].startRva] ^= 1;
    return createLatestCombatStatReader(
      profile,
      bad,
      championBytes,
      packageBytes,
    );
  },
  () => createLatestReplayState({ ...report, combatStatPackageSha256: "bad" }),
  () => {
    const bad = { ...report };
    delete bad.combatStatUpdates;
    return createLatestReplayState(bad);
  },
  () =>
    createLatestReplayState({
      ...report,
      combatStatUpdates: [{ ...report.combatStatUpdates[0], entityId: 0 }],
    }),
  () =>
    createLatestReplayState({
      ...report,
      combatStatUpdates: [
        { ...report.combatStatUpdates[0], attackDamage: NaN },
      ],
    }),
  () =>
    reader.read({
      groups: [
        {
          group: meta.fields[deps[0]].group,
          mask: (1 << meta.fields[deps[0]].index) >>> 0,
          dataHex: "fe00",
        },
      ],
    }),
  () =>
    deriveLatestCombatStats(
      {
        [deps[0]]: Infinity,
        ...Object.fromEntries(deps.slice(1).map((k) => [k, 0])),
      },
      meta,
    ),
  () => state.sampleEntity(report.heroes[0].entityId, 121),
]) {
  let rejected = false;
  try {
    await fn();
  } catch {
    rejected = true;
  }
  check(rejected, `Invalid combat input accepted: case ${rejectionChecks}`);
  rejectionChecks++;
}
const cases = [],
  add = (label, champion, t) => {
    const h = report.heroes.find((h) => h.champion === champion);
    inspection.select(h.entityId);
    const model = inspection.sample(t);
    cases.push({ label, model, drawing: inspectionPanelDrawing(model) });
  };
add("Ornn · initial recorded stats", "Ornn", 0);
add("Ornn · armor increases", "Ornn", 45);
add("Ornn · later sampled stats", "Ornn", 105);
const apHero =
  report.heroes.find((h) => h.champion === "Vladimir") ?? report.heroes[1];
add(`${apHero.champion} · spellcaster stats`, apHero.champion, 105);
const sources = {};
for (const name of [
  "latest-combat-stats.mjs",
  "latest-state-fields.mjs",
  "latest-replay-state.mjs",
  "latest-inspection.mjs",
  "latest-reconstruction.mjs",
  "latest-viewer.mjs",
  "structural-check-worker.mjs",
  "latest.html",
  "tools/inspect-latest-semantics.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const counts = {
  stats: namedApiChecks,
  inputFields: bindingChecks,
  probes: native.probes.length,
  probeScalarChecks,
  records: native.records.length,
  groupChecks,
  byteChecks,
  inputChecks,
  scalarChecks,
  updates: expectedUpdates.length,
  legacyChecks,
  snapshotChecks,
  reverseSeekChecks,
  canvasChecks,
  worldChecks,
  deathChecks,
  partialDependencyChecks: 2,
  formatChecks: 3,
  rejectionChecks,
};
check(
  groupChecks === native.counts.groups &&
    byteChecks === native.counts.bytes &&
    scalarChecks === native.counts.scalars &&
    probeScalarChecks === native.counts.probeScalars,
  "Native combat count differs",
);
await Bun.write(
  `${cache}/research/combat-stats-comparison.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "combat-stat-projection-comparison",
      packageSha256: COMBAT_STATS_SHA,
      nativeEvidenceSha256: inputs[nativePath],
      inspectorSha256: sha(await raw(import.meta.path)),
      inputs,
      sources,
      counts,
      cases,
      observedItemIds: [...observedItems].sort((a, b) => a - b),
      scope: {
        ...native.scope,
        mainViewerSourceIntegrated: true,
        canvasCommandsExecuted: true,
        browserRun: false,
        leagueAvCompared: false,
        wholeMatchVerified: false,
      },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(counts));
