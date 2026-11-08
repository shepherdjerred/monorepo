import { sha256 } from "./structural-comparison.mjs";
export const INVENTORY_SHA =
  "babbf2525b0e58cf29016acd1b743bd6a040c9850909448998b70d0fed2a56d6";
export const INVENTORY_OPCODES = [390, 437, 502, 590, 803, 951, 1008];
const PACKET_MODES = {
  390: "snapshot",
  437: "snapshot",
  502: "set",
  590: "counter",
  803: "count",
  951: "swap",
  1008: "stack",
};

export async function createLatestInventoryReader(profile, image, bytes) {
  if ((await sha256(bytes)) !== INVENTORY_SHA)
    throw Error("Pinned inventory package required");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (
    meta.schema !== 1 ||
    meta.kind !== "native-inventory-fields" ||
    meta.build !== "16.21.829.8620" ||
    meta.build !== profile.clientVersion ||
    meta.protocol !== "20e09df23c66b85e" ||
    meta.protocol !== profile.protocolDigest ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.sliceSha256 !== profile.sliceSha256 ||
    meta.slots !== 39 ||
    meta.snapshotClearedSlots !== 10
  )
    throw Error("Unsupported inventory package");
  for (const b of meta.sourceBlocks)
    if ((await sha256(image.subarray(b.startRva, b.endRva))) !== b.sha256)
      throw Error("Original inventory code changed");
  function fields(mode, data) {
    const config = meta.modes[mode];
    if (!config || data.length !== config.size)
      throw Error("Invalid inventory conversion input");
    const result = {};
    for (const [name, f] of Object.entries(config.fields)) {
      let value = 0;
      for (let i = 0; i < f.bytes; i++)
        value = (value | (f.decode[i][data[f.offset + i]] << (i * 8))) >>> 0;
      result[name] = value;
    }
    return result;
  }
  function read(observation) {
    if (!observation.complete) throw Error("Incomplete inventory packet");
    const object = observation.object,
      view = new DataView(object.buffer, object.byteOffset, object.byteLength),
      opcode = view.getUint32(8, true),
      config = meta.packets[opcode];
    if (!config || object.length !== config.objectSize)
      throw Error("Unadmitted inventory packet layout");
    let entries;
    if (config.mode === "snapshot") {
      const count = view.getUint32(40, true),
        offset = Number(view.getBigUint64(32, true)) - 0x10200000;
      if (
        count > 39 ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset + count * 168 > observation.heap.length
      )
        throw Error("Inventory vector outside owned arena");
      entries = Array.from({ length: count }, (_, i) =>
        fields(
          "snapshot",
          observation.heap.subarray(offset + i * 168, offset + (i + 1) * 168),
        ),
      );
    } else
      entries = [
        fields(config.mode, object.subarray(0, meta.modes[config.mode].size)),
      ];
    for (const f of entries)
      for (const name of ["slot", "from", "to"])
        if (Object.hasOwn(f, name) && f[name] >= 39)
          throw Error("Inventory slot outside native array");
    const entityId = view.getUint32(12, true);
    if (!entityId) throw Error("Inventory packet has no entity context");
    return { kind: config.mode, opcode, entityId, entries };
  }
  return { metadata: structuredClone(meta), fields, read };
}

// Known empty and not yet observed are different states. Native full snapshots
// clear slots 0..9; the 39-slot array also supports auxiliary/mode-specific items.
export function createLatestInventory(report) {
  if (
    report.build !== "16.21.829.8620" ||
    report.protocol !== "20e09df23c66b85e" ||
    report.inventoryPackageSha256 !== INVENTORY_SHA ||
    !Array.isArray(report.inventoryEvents)
  )
    throw Error("Admitted inventory events required");
  const ids = new Set(report.heroes.map((h) => h.entityId)),
    tracks = new Map(),
    sequences = new Set();
  for (const event of [...report.inventoryEvents].sort(
    (a, b) => a.time - b.time || a.transportSequence - b.transportSequence,
  )) {
    if (
      !ids.has(event.entityId) ||
      !Number.isFinite(event.time) ||
      event.time < 0 ||
      event.time > report.endTime ||
      !Number.isSafeInteger(event.transportSequence) ||
      event.transportSequence < 0 ||
      sequences.has(event.transportSequence) ||
      PACKET_MODES[event.opcode] !== event.kind ||
      !Array.isArray(event.entries) ||
      (event.kind === "snapshot"
        ? event.entries.length > 39
        : event.entries.length !== 1)
    )
      throw Error("Invalid inventory event provenance");
    sequences.add(event.transportSequence);
    const track = tracks.get(event.entityId) ?? [],
      previous = track.at(-1),
      slots = previous
        ? structuredClone(previous.slots)
        : Array.from({ length: 39 }, (_, slot) => ({
            slot,
            status: "unobserved",
            item: null,
          })),
      mark = (slot) => {
        if (!Number.isInteger(slot) || slot < 0 || slot >= 39)
          throw Error("Invalid inventory mutation slot");
        return slots[slot];
      },
      empty = (slot) => {
        mark(slot);
        slots[slot] = { slot, status: "observed", item: null };
      },
      source = {
        time: event.time,
        transportSequence: event.transportSequence,
        opcode: event.opcode,
      };
    if (event.kind === "snapshot") for (let i = 0; i < 10; i++) empty(i);
    for (const f of event.entries) {
      const required = {
        snapshot: [
          "slot",
          "itemId",
          "count",
          "counterB2",
          "scalarBits",
          "flagB0",
        ],
        set: ["slot", "itemId", "count", "counterB2", "scalarBits", "flagB0"],
        count: ["slot", "count"],
        stack: ["slot", "count", "counterB2"],
        swap: ["from", "to"],
        counter: ["slot", "counterB2"],
      }[event.kind];
      if (!required.every((field) => Object.hasOwn(f, field)))
        throw Error("Incomplete inventory mutation");
      for (const [field, max] of [
        ["counterB2", 65535],
        ["scalarBits", 0xffffffff],
        ["flagB0", 1],
      ])
        if (
          Object.hasOwn(f, field) &&
          (!Number.isInteger(f[field]) || f[field] < 0 || f[field] > max)
        )
          throw Error("Invalid inventory native member");
      if (event.kind === "snapshot" || event.kind === "set") {
        mark(f.slot);
        if (
          !Number.isInteger(f.count) ||
          f.count < 0 ||
          f.count > 255 ||
          !Number.isInteger(f.itemId) ||
          f.itemId < 0 ||
          f.itemId > 0xffffffff
        )
          throw Error("Invalid native item assignment");
        // Original 149470 returns without assigning when count is zero.
        if (f.count === 0) continue;
        if (f.itemId === 0)
          throw Error("Nonempty item assignment has no item identity");
        slots[f.slot] = {
          slot: f.slot,
          status: "observed",
          item: {
            itemId: f.itemId,
            count: f.count,
            native: {
              counterB2: f.counterB2,
              scalarBits: f.scalarBits,
              flagB0: f.flagB0,
            },
            source,
          },
        };
      } else if (event.kind === "swap") {
        const a = mark(f.from),
          b = mark(f.to);
        slots[f.from] = { ...b, slot: f.from };
        slots[f.to] = { ...a, slot: f.to };
      } else if (event.kind === "count" || event.kind === "stack") {
        const row = mark(f.slot);
        if (event.kind === "stack" && !row.item) continue;
        if (!Number.isInteger(f.count) || f.count < 0 || f.count > 255)
          throw Error("Invalid native stack count");
        if (f.count === 0) empty(f.slot);
        else if (row.item) {
          row.item.count = f.count;
          row.item.source = source;
          if (event.kind === "stack") row.item.native.counterB2 = f.counterB2;
        } else if (event.kind === "count")
          throw Error("Nonzero count update lacks an observed item identity");
        // Stack packet 1008 explicitly returns false for an empty slot.
      } else if (event.kind === "counter") {
        const row = mark(f.slot);
        if (row.item) {
          row.item.native.counterB2 = f.counterB2;
          row.item.source = source;
        }
      } else throw Error("Unsupported inventory mutation");
    }
    track.push({ time: event.time, slots, source });
    tracks.set(event.entityId, track);
  }
  function sample(entityId, time, transportSequence = Infinity) {
    if (
      !ids.has(entityId) ||
      !Number.isFinite(time) ||
      time < 0 ||
      time > report.endTime
    )
      throw Error("Inventory query outside admitted replay");
    if (
      transportSequence !== Infinity &&
      (!Number.isSafeInteger(transportSequence) || transportSequence < 0)
    )
      throw Error("Invalid inventory query cursor");
    const track = tracks.get(entityId) ?? [];
    let lo = 0,
      hi = track.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (
        track[mid].time < time ||
        (track[mid].time === time &&
          track[mid].source.transportSequence <= transportSequence)
      )
        lo = mid + 1;
      else hi = mid;
    }
    return lo
      ? { status: "observed", slots: structuredClone(track[lo - 1].slots) }
      : { status: "unavailable", slots: [] };
  }
  return { sample };
}
