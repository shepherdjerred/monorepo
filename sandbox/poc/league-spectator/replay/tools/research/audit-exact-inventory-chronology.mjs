import { writeFile } from "node:fs/promises";
import {
  compareRecordedInventoryFooter,
  readInventoryReplayFooter,
} from "./verify-recorded-inventory-footer.mjs";

const [inputPath, replayPath, scenePath, outputPath, tracksPath] =
  process.argv.slice(2);
if (!inputPath || !replayPath || !scenePath || !outputPath)
  throw Error(
    "Usage: bun audit-exact-inventory-chronology.mjs NATIVE_PROOF ROFL BOUND_SCENE AUDIT [ORDINARY_TRACKS]",
  );
const bytes = await Bun.file(inputPath).arrayBuffer();
const sourceSha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
if (
  !new Set([
    "fc4a64afd3546d07343ae365ac8d4db0e58b90bd5e42e82d9405e784b6adcd63",
    "21c3b017efce44d8fd939fb3b50514e3dadfe19e51c8913171af1e23b552dd63",
  ]).has(sourceSha256)
)
  throw Error("Expected a verified native inventory observation receipt");
const { build, protocol, replaySha256, sliceSha256, participants, rows } =
  JSON.parse(new TextDecoder().decode(bytes));
const rawReplay = await Bun.file(replayPath).bytes();
const scene = await Bun.file(scenePath).json();
if (
  new Bun.CryptoHasher("sha256").update(rawReplay).digest("hex") !==
    replaySha256 ||
  scene.identity.replaySha256 !== replaySha256 ||
  scene.identity.build !== build ||
  scene.identity.protocol !== protocol
)
  throw Error(
    "Inventory footer audit must use the same saved replay and bound scene",
  );
const checkpoints = Map.groupBy(
  rows.filter(({ stream }) => stream === 2),
  ({ chunkOffset }) => chunkOffset,
);
const [opening, ...later] = checkpoints.values();
if (opening?.length !== participants.length)
  throw Error("Incomplete initial native inventory checkpoint");

function snapshot(row, slots) {
  slots.fill(null, 0, 10);
  for (const { slot, itemId, count } of row.entries) {
    if (count !== 0) slots[slot] = { itemId, count };
  }
  return slots;
}

const tracks = new Map();
const state = new Map();
const counts = { clears: 0, swaps: 0, fullSnapshots: 0 };
const emptyStorage = () => Array(39).fill(null);
for (const row of opening) {
  if (row.timeSeconds !== 0 || state.has(row.context))
    throw Error("Unexpected opening inventory clock or identity");
  state.set(row.context, snapshot(row, emptyStorage()));
  tracks.set(row.context, [[0, state.get(row.context).slice()]]);
}
for (const row of rows) {
  if (row.stream !== 1) continue;
  const slots = state.get(row.context);
  const previous = JSON.stringify(slots);
  if (row.opcode === 415 || row.opcode === 1214) {
    snapshot(row, slots);
    counts.fullSnapshots++;
  } else if (row.opcode === 840 || row.opcode === 190) {
    if (row.opcode === 190) slots[row.slot] = null;
    if (row.count !== 0)
      slots[row.slot] = { itemId: row.itemId, count: row.count };
  } else if (row.opcode === 226) {
    if (
      row.from === row.to ||
      row.from >= 6 ||
      row.to >= 6 ||
      slots[row.from] === null
    )
      throw Error("Recorded swap cannot enter original playable-item gate");
    // This candidate fold does not resolve the authored per-item slot bounds.
    [slots[row.from], slots[row.to]] = [slots[row.to], slots[row.from]];
    counts.swaps++;
  } else if (row.opcode === 797 || row.opcode === 1143) {
    const item = slots[row.slot];
    if (row.opcode === 1143 && item === null) continue;
    if (row.count === 0) {
      slots[row.slot] = null;
      counts.clears++;
    } else if (item !== null) slots[row.slot] = { ...item, count: row.count };
    else throw Error("Count cannot identify the item in an unobserved slot");
  } else if (row.opcode !== 248) throw Error("Unexpected inventory mutation");
  if (previous === JSON.stringify(slots)) continue;
  const points = tracks.get(row.context);
  const entry = [row.timeSeconds, slots.slice()];
  if (points.at(-1)[0] === row.timeSeconds) points[points.length - 1] = entry;
  else points.push(entry);
}

let precedingBoundary = 0;
const comparisons = [];
for (const checkpoint of later) {
  const currentBoundary = checkpoint[0].timeSeconds;
  for (const row of checkpoint) {
    if (row.timeSeconds !== currentBoundary)
      throw Error("Inventory checkpoint did not share a primary clock");
    const expected = snapshot(row, emptyStorage()).slice(0, 10);
    const points = tracks.get(row.context);
    const matchAt = (clock) => {
      const [, sample] = points.findLast(
        ([timeSeconds]) => timeSeconds <= clock,
      );
      return expected.every(
        (item, i) =>
          item?.itemId === sample[i]?.itemId &&
          item?.count === sample[i]?.count,
      );
    };
    comparisons.push({
      participantId: row.context,
      chunkOffset: row.chunkOffset,
      timeSeconds: currentBoundary,
      precedingBoundary,
      matchesRecordedBoundary: matchAt(currentBoundary),
      matchesPrecedingBoundary: matchAt(precedingBoundary),
    });
  }
  precedingBoundary = currentBoundary;
}

const result = {
  kind: "scout-recorded-inventory-chronology-audit",
  build,
  protocol,
  replaySha256,
  sourceSha256,
  counts,
  openingRows: opening.length,
  checkpointRows: comparisons.length,
  matchedRecordedBoundary: comparisons.filter((r) => r.matchesRecordedBoundary)
    .length,
  matchedPrecedingBoundary: comparisons.filter(
    (r) => r.matchesPrecedingBoundary,
  ).length,
  comparisons,
  finalSlots: compareRecordedInventoryFooter(
    rawReplay,
    scene.participants,
    [...tracks].map(([participantId, points]) => {
      const [timeSeconds, slots] = points.at(-1);
      return { participantId, points: [[timeSeconds, slots.slice(0, 7)]] };
    }),
  ),
  scope: {
    originalItemSpecificSwapGatesVerified: false,
    snapshotClockLagProven: false,
  },
};
const audit = JSON.stringify(result, null, 2) + "\n";
await writeFile(outputPath, audit, {
  flag: "wx",
});
if (tracksPath !== undefined) {
  if (
    result.finalSlots.length !== participants.length ||
    new Set(result.finalSlots.map(({ participantId }) => participantId))
      .size !== participants.length ||
    result.finalSlots.some(({ matched }) => !matched)
  )
    throw Error("Ordinary inventory history disagrees with final ROFL slots");
  const { gameLength: durationMilliseconds } =
    readInventoryReplayFooter(rawReplay);
  const durationSeconds = durationMilliseconds / 1000;
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    durationMilliseconds !== scene.identity.durationMilliseconds
  )
    throw Error("Invalid replay duration for inventory tracks");
  const playableTracks = participants.map((participantId) => {
    const points = [];
    let previous;
    for (const [timeSeconds, nativeSlots] of tracks.get(participantId)) {
      const slots = nativeSlots.slice(0, 7);
      const key = JSON.stringify(slots);
      if (
        !Number.isFinite(timeSeconds) ||
        timeSeconds > durationSeconds ||
        timeSeconds <= (points.at(-1)?.[0] ?? -1)
      )
        throw Error("Ordinary inventory history disagrees with recorded clock");
      if (
        slots.some(
          (item) =>
            item !== null &&
            (!Number.isSafeInteger(item.itemId) ||
              item.itemId < 1 ||
              item.itemId > 0xffffffff ||
              !Number.isSafeInteger(item.count) ||
              item.count < 1 ||
              item.count > 255),
        )
      )
        throw Error("Invalid native playable item and count");
      if (previous !== key) points.push([timeSeconds, slots]);
      previous = key;
    }
    return { participantId, points };
  });
  await writeFile(
    tracksPath,
    JSON.stringify({
      kind: "scout-recorded-champion-inventory",
      build,
      protocol,
      replaySha256,
      sliceSha256,
      chronologyAuditSha256: new Bun.CryptoHasher("sha256")
        .update(audit)
        .digest("hex"),
      scope: "ordinary-stream-with-initial-checkpoint",
      verifiedFooterSlots: result.finalSlots.length * 7,
      tracks: playableTracks,
    }) + "\n",
    { flag: "wx" },
  );
}
