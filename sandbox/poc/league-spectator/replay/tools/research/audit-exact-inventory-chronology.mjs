import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { zstdDecompressSync } from "node:zlib";
import { createReplayPacketReader } from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/packet-reader.mjs";
import { openReplay } from "../../transport.mjs";
import {
  applyRecordedInventorySnapshot,
  foldRecordedInventory,
} from "./recorded-inventory-fold.mjs";
import { verifyCanonicalRecordedRift } from "./verify-canonical-rift-replay.mjs";
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

const { gameLength: durationMilliseconds } =
  readInventoryReplayFooter(rawReplay);
if (durationMilliseconds !== scene.identity.durationMilliseconds)
  throw Error("Invalid replay duration for inventory tracks");
const {
  tracks: playableTracks,
  expandedTracks: tracks,
  rawOpening,
  counts,
} = foldRecordedInventory(rows, {
  participantIds: participants,
  openingChunkOffset: opening[0].chunkOffset,
  durationSeconds: durationMilliseconds / 1000,
  audit: true,
});

let precedingBoundary = 0;
const comparisons = [];
for (const checkpoint of later) {
  const currentBoundary = checkpoint[0].timeSeconds;
  for (const row of checkpoint) {
    if (row.timeSeconds !== currentBoundary)
      throw Error("Inventory checkpoint did not share a primary clock");
    const expected = applyRecordedInventorySnapshot(row).slice(0, 10);
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
  const { sourceSha256, verifiedSlots } = await verifyCanonicalRecordedRift(
    canonicalPath,
    canonicalPin,
    replayPath,
    openReplay(replayBuffer),
  );
  return { sourceSha256, verifiedSlots };
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
