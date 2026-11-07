import { resolve } from "node:path";
import { createReadStream } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import {
  createLatestInventoryReader,
  createLatestInventory,
  INVENTORY_SHA,
  INVENTORY_OPCODES,
} from "../latest-inventory.mjs";
import {
  createLatestItemAssets,
  ITEM_ASSETS_SHA,
} from "../latest-item-assets.mjs";
import { createLatestReplayState } from "../latest-replay-state.mjs";
import { primaryResourcePresentation } from "../latest-champion-state.mjs";
import {
  createLatestInspection,
  inspectionPanelDrawing,
  paintInspectionPanel,
  inspectionPanelSvg,
} from "../latest-inspection.mjs";

const [arg] = process.argv.slice(2);
if (!arg) throw Error("Usage: inspect-inventory.mjs <cache>");
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
  bytes = (s) => new Uint8Array(Buffer.from(s, "hex")),
  nativePath = `${cache}/research/inventory-native.json`,
  native = await json(nativePath),
  ownedPath = `${cache}/research/inventory-state-native.json`,
  owned = await json(ownedPath),
  assetProof = await json(`${cache}/research/item-assets-native.json`),
  samples = await json(`${cache}/research/inventory-input.json`),
  objects = await json(`${cache}/research/inventory-objects-native.json`),
  comparison = await json(
    `${cache}/research/inventory-objects-comparison.json`,
  ),
  report = await json(`${cache}/research/latest-semantics-inventory.json`),
  baseline = await json(`${cache}/research/latest-semantics-experience.json`),
  profile = await json(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`),
  packageBytes = await raw(`${cache}/public/latest-inventory/package.json`),
  itemBytes = await raw(`${cache}/public/latest-items/package.json`),
  reader = await createLatestInventoryReader(profile, image, packageBytes),
  itemAssets = await createLatestItemAssets(report, itemBytes);
check(
  native.packageSha256 === INVENTORY_SHA &&
    report.inventoryPackageSha256 === INVENTORY_SHA &&
    owned.sourceSha256 === inputs[nativePath] &&
    assetProof.packageSha256 === ITEM_ASSETS_SHA,
  "Inventory evidence/package mismatch",
);
for (const [record, preparer] of [
  [native, "prepare-inventory.py"],
  [owned, "observe-inventory-state.py"],
  [assetProof, "prepare-item-assets.py"],
]) {
  check(
    record.preparerSha256 === sha(await raw(`${root}/tools/${preparer}`)),
    "Native inventory preparer changed",
  );
  for (const [p, h] of Object.entries(record === native ? record.inputs : {}))
    check(sha(await raw(p)) === h, "Native inventory input changed");
  for (const [name, h] of Object.entries(record.sources ?? {}))
    check(
      sha(await raw(`${root}/tools/${name}`)) === h,
      "Native inventory helper changed",
    );
  for (const b of record.originalBlocks ?? [])
    check(
      sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
      "Original inventory instruction changed",
    );
}
check(
  assetProof.wadParserSha256 ===
    sha(await raw(`${cache}/research/venv/Lib/site-packages/cdtb/wad.py`)),
  "Installed item parser changed",
);
const archives = [];
for (const [path, expected] of Object.entries(assetProof.inputs)) {
  const hasher = new Bun.CryptoHasher("sha256");
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    hasher.update(chunk);
    size += chunk.length;
  }
  check(
    size === expected.bytes && hasher.digest("hex") === expected.sha256,
    "Installed item archive changed",
  );
  archives.push({ path, ...expected });
}
check(
  comparison.build === report.build &&
    comparison.matched === Object.keys(samples.packets).length &&
    comparison.unresolved === 0 &&
    comparison.mismatches === 0 &&
    comparison.results.length === comparison.matched,
  "Inventory packet native/WASM coverage incomplete",
);
for (const result of comparison.results) {
  const p = samples.packets[result.sampleId],
    o = objects.observations[result.sampleId];
  check(
    p &&
      o &&
      result.status === "matched" &&
      result.opcode === p.opcode &&
      o.status === "complete" &&
      o.payloadSha256 === sha(bytes(p.payloadHex)) &&
      o.param === p.param &&
      o.opcode === p.opcode &&
      result.inputBytes === o.input &&
      result.consumed === o.consumed &&
      o.input === o.consumed,
    "Inventory structural sample changed",
  );
}
let wireProbeChecks = 0,
  entryChecks = 0,
  slotChecks = 0,
  legacyChecks = 0,
  snapshotChecks = 0,
  canvasChecks = 0,
  worldChecks = 0;
for (const p of native.wireProbes) {
  same(
    reader.fields(p.mode, bytes(p.dataHex)),
    p.values,
    "Original inventory field conversion differs",
  );
  wireProbeChecks++;
}
const eventKey = (p) => `${p.stream}:${p.chunkId}:${p.blockOffset}`,
  events = new Map(report.inventoryEvents.map((e) => [eventKey(e), e])),
  nativeEvents = new Map(),
  counts = {};
check(
  events.size === native.records.length,
  "Inventory event count/identity differs",
);
for (const n of native.records) {
  const p = samples.packets[n.packetKey],
    o = objects.observations[n.packetKey],
    actual = reader.read({
      complete: o.status === "complete",
      object: bytes(o.object),
      heap: bytes(o.heap),
    }),
    event = events.get(eventKey(p));
  check(
    event &&
      p.param === n.entityId &&
      p.time === n.time &&
      p.stream === n.stream &&
      p.opcode === n.opcode,
    "Recorded inventory identity differs",
  );
  same(
    actual,
    {
      kind: n.mode,
      opcode: n.opcode,
      entityId: n.entityId,
      entries: n.entries.map((e) => e.values),
    },
    "Original inventory packet projection differs",
  );
  for (const e of n.entries) {
    same(
      reader.fields(n.mode, bytes(e.dataHex)),
      e.values,
      "Recorded native item field differs",
    );
    entryChecks++;
  }
  for (const [k, v] of Object.entries(actual))
    same(event[k], v, `Worker inventory ${k} differs`);
  nativeEvents.set(n.packetKey, event);
  counts[n.opcode] = (counts[n.opcode] ?? 0) + 1;
}
for (const [k, v] of Object.entries(baseline)) {
  if (k === "decodedPackets") {
    const expected = { ...v };
    for (const [op, count] of Object.entries(counts)) expected[op] = count;
    same(report[k], expected, "Inventory decoded-packet accounting differs");
  } else if (k === "unhandledOpcodes") {
    const expected = { ...v };
    for (const op of INVENTORY_OPCODES) {
      const count = report.inventoryEvents.filter(
        (e) => e.stream === 1 && e.opcode === op,
      ).length;
      if (count) {
        check(expected[op] === count, "Unhandled inventory count differs");
        delete expected[op];
      }
    }
    same(report[k], expected, "Unrelated unhandled packet accounting changed");
  } else if (k === "summary") {
    same(
      report.summary,
      { ...v, inventoryEvents: native.records.length },
      "Prior reconstruction summary changed",
    );
  } else same(report[k], v, `Prior reconstruction changed: ${k}`);
  legacyChecks++;
}
const inventory = createLatestInventory(report),
  state = createLatestReplayState(report, {
    entities: report.worldEntities,
    updates: report.worldStateUpdates,
  }),
  resources = new Map(),
  scene = await json(`${cache}/public/latest-scene/manifest.json`);
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
  observedIds = new Set(),
  icons = new Map(),
  pngs = new Map();
for (const a of Object.values(itemAssets.metadata.items)) {
  check(
    a.id >= 0 && itemAssets.metadata.items[a.id] === a,
    "Invalid item catalog key",
  );
  if (!pngs.has(a.iconSha256)) {
    const png = await raw(`${cache}/public/latest-items/${a.icon}`),
      view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    check(
      sha(png) === a.iconSha256 &&
        Buffer.from(png.subarray(0, 8)).toString("hex") ===
          "89504e470d0a1a0a" &&
        view.getUint32(16) === a.width &&
        view.getUint32(20) === a.height,
      "Installed item PNG differs",
    );
    pngs.set(a.iconSha256, png);
    icons.set(
      a.iconSha256,
      `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
    );
  }
  check(
    assetProof.assets[a.sourcePath]?.sha256 === a.iconSha256,
    "Item asset extraction provenance differs",
  );
}
check(
  Object.keys(itemAssets.metadata.items).length === assetProof.counts.items &&
    pngs.size === assetProof.counts.icons,
  "Installed item catalog coverage differs",
);
const projection = (sample) =>
  sample.slots
    .filter((s) => s.status === "observed")
    .map((s) => ({
      slot: s.slot,
      item: s.item
        ? {
            itemId: s.item.itemId,
            count: s.item.count,
            counterB2: s.item.native.counterB2,
          }
        : null,
    }));
for (const n of owned.records) {
  const e = nativeEvents.get(n.packetKey),
    sample = inventory.sample(n.entityId, n.time, e.transportSequence);
  same(
    projection(sample),
    n.slots,
    "Native slot storage/API item identity or stack count differs",
  );
  slotChecks += n.slots.length;
}
check(
  slotChecks === owned.counts.slotSnapshots &&
    owned.records.length === native.records.length,
  "Native inventory state coverage differs",
);
const times = [
    ...new Set([
      0,
      report.endTime,
      ...report.inventoryEvents.flatMap((e) => [
        Math.max(0, e.time - 0.001),
        e.time,
      ]),
    ]),
  ].sort((a, b) => a - b),
  saved = new Map();
for (const h of report.heroes) {
  inspection.select(h.entityId);
  for (const t of times) {
    const sample = inventory.sample(h.entityId, t),
      eventsForHero = owned.records.filter(
        (n) => n.entityId === h.entityId && n.time <= t,
      ),
      last = eventsForHero.at(-1),
      model = inspection.sample(t),
      drawing = inspectionPanelDrawing(model);
    check(
      last && sample.status === "observed",
      "Initial inventory unavailable",
    );
    same(
      projection(sample),
      last.slots,
      "Inventory absolute-time sample differs",
    );
    same(
      state.sampleEntity(h.entityId, t).inventory,
      sample,
      "Shared replay inventory differs",
    );
    for (const row of model.inventoryItems)
      if (row.item) {
        observedIds.add(row.item.itemId);
        same(
          row.item.presentation,
          itemAssets.get(row.item.itemId),
          "Panel item asset differs",
        );
      }
    const commands = [],
      context = {
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
          check(pngs.has(image.key), "Canvas received unowned icon");
          commands.push("image");
        },
      };
    paintInspectionPanel(
      context,
      drawing,
      new Map([...pngs.keys()].map((key) => [key, { key }])),
    );
    same(
      commands,
      ["clear", ...drawing.ops.map((o) => o.kind)],
      "Panel Canvas drawing sequence differs",
    );
    check(
      drawing.itemRegions.length ===
        model.inventoryItems.filter((s) => s.item).length &&
        inspectionPanelSvg(drawing, icons).includes("data:image/png;base64,"),
      "Panel item image/tooltip missing",
    );
    saved.set(`${h.entityId}:${t}`, JSON.stringify(model));
    snapshotChecks++;
    canvasChecks++;
  }
  for (const t of [...times].reverse())
    check(
      JSON.stringify(inspection.sample(t)) === saved.get(`${h.entityId}:${t}`),
      "Inventory panel reverse seek differs",
    );
}
for (const e of report.worldEntities) {
  inspection.select(e.entityId);
  check(
    inspection.sample(report.endTime).inventoryStatus === "unavailable",
    "World unit inherited champion inventory",
  );
  worldChecks++;
}
const cases = [],
  add = (label, id, t) => {
    inspection.select(id);
    const model = inspection.sample(t);
    cases.push({ label, model, drawing: inspectionPanelDrawing(model) });
  },
  ornn = report.heroes.find((h) => h.champion === "Ornn"),
  stack = report.inventoryEvents.find((e) =>
    e.entries.some((f) => f.itemId && f.count > 1),
  ),
  swap = report.inventoryEvents.find((e) => e.kind === "swap");
add("Initial inventory and auxiliary item", ornn.entityId, 0);
add("Purchased items", ornn.entityId, 45);
add("Recorded potion stack", stack.entityId, stack.time);
add("Later inventory", ornn.entityId, 105);
add("Before recorded slot swap", swap.entityId, swap.time - 0.001);
add("After recorded slot swap", swap.entityId, swap.time);
const edgeCases = [];
function synthetic(label, events, verify) {
  const s = createLatestInventory({ ...report, inventoryEvents: events });
  verify(s);
  edgeCases.push(label);
}
const set = report.inventoryEvents.find((e) => e.kind === "set"),
  make = (kind, opcode, entries, transportSequence) => ({
    ...set,
    time: 1,
    kind,
    opcode,
    entries,
    transportSequence,
  });
synthetic(
  "Counter before creation is not backfilled",
  [
    make("counter", 590, [{ slot: set.entries[0].slot, counterB2: 99 }], 1),
    make("set", 502, set.entries, 2),
  ],
  (s) =>
    check(
      s.sample(set.entityId, 1).slots[set.entries[0].slot].item.native
        .counterB2 === set.entries[0].counterB2,
      "Counter was applied to future item",
    ),
);
synthetic(
  "Zero-count assignment does not overwrite",
  [
    make("set", 502, set.entries, 1),
    make("set", 502, [{ ...set.entries[0], count: 0 }], 2),
  ],
  (s) =>
    check(
      s.sample(set.entityId, 1).slots[set.entries[0].slot].item.itemId ===
        set.entries[0].itemId,
      "Zero-count assignment cleared existing item",
    ),
);
synthetic(
  "Stack update on unobserved empty slot is a no-op",
  [make("stack", 1008, [{ slot: 38, count: 0, counterB2: 0 }], 1)],
  (s) =>
    check(
      s.sample(set.entityId, 1).slots[38].status === "unobserved",
      "Empty stack created an observation",
    ),
);
synthetic(
  "Snapshots leave auxiliary unknown slots unobserved",
  [{ ...report.inventoryEvents[0], entityId: set.entityId }],
  (s) =>
    check(
      s.sample(set.entityId, 1).slots[38].status === "unobserved",
      "Snapshot invented auxiliary emptiness",
    ),
);
let rejectionChecks = 0;
const rejects = [
  () => createLatestInventory({ ...report, build: "16.14.794.5912" }),
  () => createLatestInventory({ ...report, inventoryPackageSha256: "bad" }),
  () =>
    createLatestInventory({
      ...report,
      inventoryEvents: [{ ...set, entityId: 0 }],
    }),
  () =>
    createLatestInventory({
      ...report,
      inventoryEvents: [{ ...set, kind: "swap" }],
    }),
  () =>
    createLatestInventory({
      ...report,
      inventoryEvents: [{ ...set, entries: [{ ...set.entries[0], slot: 39 }] }],
    }),
  () => createLatestInventory({ ...report, inventoryEvents: [set, set] }),
  () => inventory.sample(set.entityId, 121),
  () => inventory.sample(set.entityId, 1, -1),
  () => itemAssets.get(0xffffffff),
  () => createLatestInspection(report, state, resources),
  () => reader.read({ complete: false }),
  () => reader.fields("set", new Uint8Array(1)),
  () =>
    paintInspectionPanel(
      {
        clearRect() {},
        fillRect() {},
        fillText() {},
        drawImage() {},
      },
      cases[0].drawing,
    ),
  () => inspectionPanelSvg(cases[0].drawing),
  () =>
    createLatestItemAssets({ ...report, build: "16.14.794.5912" }, itemBytes),
  () =>
    createLatestInventoryReader(
      { ...profile, protocolDigest: "bad" },
      image,
      packageBytes,
    ),
  () => createLatestInventoryReader(profile, image, new Uint8Array()),
];
for (const fn of rejects) {
  let rejected = false;
  try {
    await fn();
  } catch {
    rejected = true;
  }
  check(rejected, "Invalid inventory input accepted");
  rejectionChecks++;
}
const sources = {};
for (const name of [
  "latest-inventory.mjs",
  "latest-item-assets.mjs",
  "latest-replay-state.mjs",
  "latest-inspection.mjs",
  "latest-reconstruction.mjs",
  "latest-viewer.mjs",
  "structural-check-worker.mjs",
  "latest.html",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const result = {
  schema: 1,
  kind: "inventory-and-inspection-comparison",
  packageSha256: INVENTORY_SHA,
  itemAssetsSha256: ITEM_ASSETS_SHA,
  nativeEvidenceSha256: inputs[nativePath],
  ownedStateEvidenceSha256: inputs[ownedPath],
  inspectorSha256: sha(await raw(import.meta.path)),
  inputs,
  sources,
  archives,
  counts: {
    structuralPackets: comparison.matched,
    inventoryPackets: native.records.length,
    entryChecks,
    wireProbeChecks,
    slotChecks,
    snapshotChecks,
    reverseSeekChecks: snapshotChecks,
    canvasChecks,
    worldChecks,
    observedItems: observedIds.size,
    catalogItems: assetProof.counts.items,
    catalogIcons: pngs.size,
    legacyChecks,
    edgeCases: edgeCases.length,
    rejectionChecks,
  },
  cases,
  edgeCases,
  observedItemIds: [...observedIds].sort((a, b) => a - b),
  scope: {
    nativeSlotPrimitivesExecuted: true,
    nativeApiIdentityCountRead: true,
    mainViewerSourceIntegrated: true,
    canvasCommandsExecuted: true,
    installedItemIconsPrepared: true,
    completeInventoryRuntimeExecuted: false,
    counterB2SemanticsVerified: false,
    opaqueScalarB4RuntimeVerified: false,
    browserRun: false,
    leagueAvCompared: false,
    wholeMatchInventoryVerified: false,
  },
};
await Bun.write(
  `${cache}/research/inventory-comparison.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result.counts));
