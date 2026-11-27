import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { zstdDecompressSync } from "node:zlib";
import { createReplayPacketReader } from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/packet-reader.mjs";
import {
  compareRecordedInventoryFooter,
  readInventoryReplayFooter,
} from "./verify-recorded-inventory-footer.mjs";

const { positionals, values } = parseArgs({
  options: {
    current: { type: "boolean" },
    "canonical-match": { type: "string" },
    "canonical-match-sha256": { type: "string" },
    "native-proof-sha256": { type: "string" },
  },
  allowPositionals: true,
});
const [inputPath, replayPath, scenePath, outputPath, tracksPath, ...extra] =
  positionals;
const canonicalPath = values["canonical-match"];
const canonicalPin = values["canonical-match-sha256"];
const nativePin = values["native-proof-sha256"];
const sha256Pattern = /^[a-f0-9]{64}$/;
if (
  !inputPath ||
  !replayPath ||
  !scenePath ||
  !outputPath ||
  extra.length ||
  (values.current
    ? !canonicalPath ||
      !sha256Pattern.test(canonicalPin) ||
      !sha256Pattern.test(nativePin)
    : canonicalPath !== undefined ||
      canonicalPin !== undefined ||
      nativePin !== undefined)
)
  throw Error(
    "Usage: bun audit-exact-inventory-chronology.mjs [--current --native-proof-sha256 SHA --canonical-match MATCH_V5_JSON --canonical-match-sha256 SHA] NATIVE_PROOF ROFL BOUND_SCENE AUDIT [ORDINARY_TRACKS]",
  );
const sha = (value) =>
  new Bun.CryptoHasher("sha256").update(value).digest("hex");
const bytes = await Bun.file(inputPath).arrayBuffer();
const sourceSha256 = sha(bytes);
const acceptedDigests = values.current
  ? [nativePin]
  : [
      "fc4a64afd3546d07343ae365ac8d4db0e58b90bd5e42e82d9405e784b6adcd63",
      "21c3b017efce44d8fd939fb3b50514e3dadfe19e51c8913171af1e23b552dd63",
    ];
if (!acceptedDigests.includes(sourceSha256))
  throw Error("Expected a verified native inventory observation receipt");
const {
  build,
  protocol,
  replaySha256,
  sliceSha256,
  archiveSha256,
  participants,
  rows,
  sceneSha256,
} = JSON.parse(new TextDecoder().decode(bytes));
const replayBuffer = await Bun.file(replayPath).arrayBuffer();
const rawReplay = new Uint8Array(replayBuffer);
const sceneBytes = await Bun.file(scenePath).bytes();
const scene = JSON.parse(
  new TextDecoder("utf-8", { fatal: true }).decode(sceneBytes),
);
if (
  sha(rawReplay) !== replaySha256 ||
  scene.identity.replaySha256 !== replaySha256 ||
  scene.identity.build !== build ||
  scene.identity.protocol !== protocol ||
  (values.current && sha(sceneBytes) !== sceneSha256)
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
if (values.current) {
  const original = createReplayPacketReader(replayBuffer, (input, output) =>
    zstdDecompressSync(input, { maxOutputLength: output.length }),
  );
  const participantsById = new Set(participants);
  if (
    build !== "16.23.841.8428" ||
    protocol !== "8bbfcd5af2bc92db" ||
    original.build !== build ||
    original.protocol !== protocol ||
    original.durationMilliseconds !== scene.identity.durationMilliseconds ||
    archiveSha256 !==
      "c7288a5607c95d50f8333385a0fa84cb089ac53c24375433d6432a1e65c009d7" ||
    sliceSha256 !==
      "de6db1683eb61358d0aaf9fac44ef722850a927263eae7f68212add8621a500e" ||
    checkpoints.size !== original.keyframes.length ||
    participants.length !== 10 ||
    participantsById.size !== 10 ||
    original.keyframes.some(({ chunkOffset, timeSeconds }) => {
      const snapshot = checkpoints.get(chunkOffset);
      return (
        snapshot?.length !== 10 ||
        new Set(snapshot.map(({ context }) => context)).size !== 10 ||
        snapshot.some(
          (row) =>
            !participantsById.has(row.context) ||
            row.opcode !== 1214 ||
            row.timeSeconds !== timeSeconds,
        )
      );
    })
  )
    throw Error("Current inventory requires complete original snapshots");
}

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
const rawOpening = new Map(
  [...state].map(([context, slots]) => [context, slots.slice()]),
);
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
    const matches = (sample) =>
      expected.every(
        (item, i) =>
          item?.itemId === sample[i]?.itemId &&
          item?.count === sample[i]?.count,
      );
    const matchAt = (clock) => {
      const [, sample] = points.findLast(
        ([timeSeconds]) => timeSeconds <= clock,
      );
      return matches(sample);
    };
    comparisons.push({
      participantId: row.context,
      chunkOffset: row.chunkOffset,
      timeSeconds: currentBoundary,
      precedingBoundary,
      matchesRecordedBoundary: matchAt(currentBoundary),
      matchesPrecedingBoundary: matchAt(precedingBoundary),
      ...(values.current
        ? {
            matchesRawOpeningBeforeSameClockGameplay:
              precedingBoundary === 0 && matches(rawOpening.get(row.context)),
            matchesAnyOlderFoldState: points.some(
              ([time, slots]) => time < precedingBoundary && matches(slots),
            ),
          }
        : {}),
    });
  }
  precedingBoundary = currentBoundary;
}

async function verifyCanonicalFooter() {
  const canonicalBytes = await Bun.file(canonicalPath).bytes();
  const canonicalSha256 = sha(canonicalBytes);
  if (canonicalSha256 !== canonicalPin)
    throw Error("Current inventory requires the reviewed Riot Match-V5 result");
  const canonical = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(canonicalBytes),
  );
  const game = /^([A-Z0-9]+)-(\d+)\.rofl$/.exec(basename(replayPath));
  if (
    !game ||
    canonical.metadata.matchId !== `${game[1]}_${game[2]}` ||
    String(canonical.info.gameId) !== game[2] ||
    canonical.info.gameVersion !== build ||
    canonical.info.mapId !== 11 ||
    canonical.info.gameMode !== "CLASSIC" ||
    canonical.info.participants.length !== 10
  )
    throw Error("Riot Match-V5 result differs from the bound Rift replay");
  const footer = JSON.parse(readInventoryReplayFooter(rawReplay).statsJson);
  const matched = new Set();
  for (const row of footer) {
    const candidates = canonical.info.participants.filter(
      (member) =>
        member.riotIdGameName === row.RIOT_ID_GAME_NAME &&
        member.riotIdTagline === row.RIOT_ID_TAG_LINE &&
        member.teamId === Number(row.TEAM) &&
        member.championName === row.SKIN,
    );
    if (candidates.length !== 1 || matched.has(candidates[0]))
      throw Error("Riot Match-V5 inventory lacks a unique bound participant");
    const [member] = candidates;
    matched.add(member);
    for (let slot = 0; slot < 7; slot++)
      if (member[`item${slot}`] !== Number(row[`ITEM${slot}`]))
        throw Error(
          "Riot Match-V5 ordered inventory differs from the replay footer",
        );
  }
  if (matched.size !== 10)
    throw Error("Riot Match-V5 final inventory is incomplete");
  return { sourceSha256: canonicalSha256, verifiedSlots: matched.size * 7 };
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
  ...(values.current
    ? {
        canonicalFooter: await verifyCanonicalFooter(),
        snapshotChronology: {
          matchedRawOpeningBeforeSameClockGameplay: comparisons.filter(
            (row) =>
              !row.matchesPrecedingBoundary &&
              row.matchesRawOpeningBeforeSameClockGameplay,
          ).length,
          matchedOlderFoldStateWithoutClockProof: comparisons.filter(
            (row) =>
              !row.matchesPrecedingBoundary &&
              !row.matchesRawOpeningBeforeSameClockGameplay &&
              row.matchesAnyOlderFoldState,
          ).length,
        },
      }
    : {}),
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
