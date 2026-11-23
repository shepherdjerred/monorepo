const playableSlots = 7;
const participantCount = 10;
const decoder = new TextDecoder("utf-8", { fatal: true });

export function readInventoryReplayFooter(replayBytes) {
  if (!(replayBytes instanceof Uint8Array) || replayBytes.byteLength < 32)
    throw Error("Original ROFL bytes required for terminal inventory");
  const footerEnd = replayBytes.byteLength - 4;
  const view = new DataView(
    replayBytes.buffer,
    replayBytes.byteOffset,
    replayBytes.byteLength,
  );
  const length = view.getUint32(footerEnd, true);
  const start = footerEnd - length;
  if (
    view.getUint32(0, false) !== 0x52494f54 ||
    view.getUint16(4, true) !== 2 ||
    length === 0 ||
    length > 4 * 1024 * 1024 ||
    start < 15 + replayBytes[14] + 256
  )
    throw Error("Invalid ROFL footer bounds for terminal inventory");
  return JSON.parse(decoder.decode(replayBytes.subarray(start, footerEnd)));
}

export function compareRecordedInventoryFooter(
  replayBytes,
  participants,
  tracks,
) {
  const footer = readInventoryReplayFooter(replayBytes);
  const rows = JSON.parse(footer.statsJson);
  const trackById = new Map(
    tracks.map((track) => [track.participantId, track]),
  );
  if (
    !Array.isArray(rows) ||
    rows.length !== participantCount ||
    tracks.length !== participantCount ||
    trackById.size !== participantCount ||
    participants.length !== participantCount
  )
    throw Error("Terminal inventory requires a complete replay roster");
  const used = new Set();
  return participants.map(({ participantId, championName, teamId }) => {
    const matchedRows = rows.filter(
      (row) => row.SKIN === championName && Number(row.TEAM) === teamId,
    );
    const row = matchedRows[0];
    const terminal = trackById.get(participantId)?.points.at(-1)?.[1];
    if (
      matchedRows.length !== 1 ||
      used.has(row) ||
      !trackById.delete(participantId) ||
      !Array.isArray(terminal) ||
      terminal.length !== playableSlots
    )
      throw Error("Terminal inventory lacks a unique bound champion");
    used.add(row);
    const expected = Array.from({ length: playableSlots }, (_, slot) => {
      const value = row[`ITEM${slot}`];
      const id = Number(value);
      if (
        typeof value !== "string" ||
        !/^\d{1,10}$/.test(value) ||
        id > 0xffffffff
      )
        throw Error("Terminal inventory footer lacks a valid item ID");
      return id;
    });
    const projected = expected.map((_id, slot) => {
      const item = terminal[slot];
      if (item === null) return 0;
      if (
        !Number.isSafeInteger(item?.itemId) ||
        item.itemId < 1 ||
        item.itemId > 0xffffffff
      )
        throw Error("Terminal inventory track lacks a valid item ID");
      return item.itemId;
    });
    return {
      participantId,
      matched: expected.every((item, slot) => item === projected[slot]),
      expected,
      projected,
    };
  });
}

export function verifyRecordedInventoryFooter(
  replayBytes,
  participants,
  tracks,
) {
  const comparisons = compareRecordedInventoryFooter(
    replayBytes,
    participants,
    tracks,
  );
  const mismatch = comparisons.find(({ matched }) => !matched);
  if (mismatch !== undefined)
    throw Error(
      `Final inventory differs from ROFL footer for participant ${mismatch.participantId}`,
    );
  return comparisons;
}
