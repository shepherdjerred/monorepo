const storageSlots = 39;
const ordinarySlots = 7;
const snapshotSlots = 10;

const emptyStorage = () => Array(storageSlots).fill(null);
const sameSlotPrefix = (left, right) =>
  left.every(
    (item, index) =>
      item?.itemId === right[index]?.itemId &&
      item?.count === right[index]?.count,
  );

function checkSlot(slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= storageSlots)
    throw Error("Inventory slot is outside native storage");
}

function checkCount(count) {
  if (!Number.isInteger(count) || count < 0 || count > 255)
    throw Error("Inventory count is outside native storage");
}

function readItem(itemId, count) {
  if (!Number.isInteger(itemId) || itemId < 1 || itemId > 0xffffffff)
    throw Error("Invalid native inventory item ID");
  return { itemId, count };
}

/** Original snapshots clear the native ten-slot group, then assign entries. */
export function applyRecordedInventorySnapshot(row, slots = emptyStorage()) {
  if (!Array.isArray(row.entries) || row.entries.length > storageSlots)
    throw Error("Invalid native inventory snapshot entries");
  const seen = new Set();
  slots.fill(null, 0, snapshotSlots);
  for (const { slot, itemId, count } of row.entries) {
    checkSlot(slot);
    checkCount(count);
    if (seen.has(slot)) throw Error("Duplicate native inventory snapshot slot");
    seen.add(slot);
    if (count !== 0) slots[slot] = readItem(itemId, count);
  }
  return slots;
}

function applyMutation(row, slots, counts) {
  if (row.opcode === 415 || row.opcode === 1214) {
    applyRecordedInventorySnapshot(row, slots);
    counts.fullSnapshots++;
    return;
  }
  if (row.opcode === 226) {
    const { from, to } = row;
    checkSlot(from);
    checkSlot(to);
    if (from === to || from >= 6 || to >= 6 || slots[from] === null)
      throw Error("Recorded swap cannot enter original playable-item gate");
    // Authored per-item slot bounds are outside the verified fold.
    [slots[from], slots[to]] = [slots[to], slots[from]];
    counts.swaps++;
    return;
  }
  checkSlot(row.slot);
  if (row.opcode === 248) return;
  checkCount(row.count);
  if (row.opcode === 840 || row.opcode === 190) {
    if (row.opcode === 190) slots[row.slot] = null;
    if (row.count !== 0) slots[row.slot] = readItem(row.itemId, row.count);
    return;
  }
  if (row.opcode !== 797 && row.opcode !== 1143)
    throw Error("Unexpected inventory mutation");
  const item = slots[row.slot];
  if (row.opcode === 1143 && item === null) return;
  if (row.count === 0) {
    slots[row.slot] = null;
    counts.clears++;
  } else if (item !== null) slots[row.slot] = { ...item, count: row.count };
  else throw Error("Count cannot identify the item in an unobserved slot");
}

function appendPoint(points, time, slots, deduplicate) {
  if (points.at(-1)?.[0] === time) points.pop();
  const previous = points.at(-1);
  if (
    !deduplicate ||
    previous === undefined ||
    !sameSlotPrefix(previous[1], slots)
  )
    points.push([time, slots]);
}

/**
 * Fold decoded opening rows and ordinary mutations in original delivery order.
 * Later checkpoint snapshots have no proven replay-clock restoration semantics.
 */
export function foldRecordedInventory(
  rows,
  { participantIds, openingChunkOffset, durationSeconds, audit = false },
) {
  const roster = [...participantIds];
  const expected = new Set(roster);
  if (
    roster.length !== 10 ||
    expected.size !== roster.length ||
    roster.some((id) => !Number.isInteger(id) || id <= 0) ||
    !Number.isSafeInteger(openingChunkOffset) ||
    openingChunkOffset < 0 ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  )
    throw Error("Inventory fold requires a complete roster and original clock");
  const visible = new Map();
  const state = new Map();
  const expandedTracks = audit ? new Map() : undefined;
  const rawOpening = audit ? new Map() : undefined;
  const counts = { clears: 0, swaps: 0, fullSnapshots: 0 };
  let previousTime = 0;
  let ordinaryStarted = false;
  for (const row of rows) {
    if (row.stream === 2) {
      if (row.chunkOffset !== openingChunkOffset) continue;
      if (
        ordinaryStarted ||
        row.timeSeconds !== 0 ||
        !expected.has(row.context) ||
        state.has(row.context) ||
        (row.opcode !== 415 && row.opcode !== 1214)
      )
        throw Error("Unexpected opening inventory clock or identity");
      const slots = applyRecordedInventorySnapshot(row);
      state.set(row.context, slots);
      visible.set(row.context, [[0, slots.slice(0, ordinarySlots)]]);
      expandedTracks?.set(row.context, [[0, slots.slice()]]);
      rawOpening?.set(row.context, slots.slice());
      continue;
    }
    if (state.size !== expected.size)
      throw Error("Incomplete initial native inventory checkpoint");
    if (row.stream !== 1) throw Error("Unexpected inventory mutation stream");
    if (
      !Number.isFinite(row.timeSeconds) ||
      row.timeSeconds < previousTime ||
      row.timeSeconds > durationSeconds
    )
      throw Error("Ordinary inventory history disagrees with recorded clock");
    ordinaryStarted = true;
    previousTime = row.timeSeconds;
    const slots = state.get(row.context);
    if (slots === undefined) throw Error("Unexpected inventory participant");
    const previous = expandedTracks === undefined ? undefined : slots.slice();
    applyMutation(row, slots, counts);
    const visiblePoints = visible.get(row.context);
    if (!sameSlotPrefix(visiblePoints.at(-1)[1], slots))
      appendPoint(
        visiblePoints,
        row.timeSeconds,
        slots.slice(0, ordinarySlots),
        true,
      );
    if (previous !== undefined && !sameSlotPrefix(previous, slots))
      appendPoint(
        expandedTracks.get(row.context),
        row.timeSeconds,
        slots.slice(),
        false,
      );
  }
  if (state.size !== expected.size)
    throw Error("Incomplete initial native inventory checkpoint");
  const tracks = roster.map((participantId) => ({
    participantId,
    points: visible.get(participantId),
  }));
  return audit ? { tracks, expandedTracks, rawOpening, counts } : { tracks };
}
