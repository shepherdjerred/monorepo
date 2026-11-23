import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import { openReplay, replayPacketEnvelopes } from "../transport.mjs";

const [, , replayPath, ...extraArguments] = process.argv;
if (!replayPath || extraArguments.length)
  throw Error("Usage: node inspect-packet-envelopes.mjs <replay.rofl>");

const bytes = readFileSync(replayPath);
const replay = openReplay(new Uint8Array(bytes).buffer);
const decompress = (stored, target) =>
  zstdDecompressSync(stored, { maxOutputLength: target.byteLength });
const floatBits = new DataView(new ArrayBuffer(4));
function asFloat32(bits) {
  floatBits.setUint32(0, bits);
  return floatBits.getFloat32(0);
}

const streams = {};
let chunks = 0;
let envelopes = 0;
let accumulatedFloat64 = 0;
let accumulatedFloat32 = 0;
for (const record of replayPacketEnvelopes(replay, decompress)) {
  const summary = (streams[record.stream] ??= {
    chunks: 0,
    envelopes: 0,
    recordTypes: {},
    finalObservedSecondTimeSeconds: null,
    finalCandidateFirstTimeSeconds: { float64: null, float32: null },
    differingCandidateMilliseconds: 0,
  });
  if (record.blockOffset === 0) {
    chunks++;
    summary.chunks++;
    accumulatedFloat64 = 0;
    accumulatedFloat32 = 0;
  }
  if (record.marker & 128) {
    accumulatedFloat64 += record.firstTimeBits * 0.001;
    accumulatedFloat32 = Math.fround(
      accumulatedFloat32 +
        Math.fround(record.firstTimeBits * Math.fround(0.001)),
    );
  } else {
    accumulatedFloat64 = accumulatedFloat32 = asFloat32(record.firstTimeBits);
  }
  const secondTime = asFloat32(record.secondTimeBits);
  if (!Number.isFinite(accumulatedFloat64) || !Number.isFinite(secondTime))
    throw Error(
      `Nonfinite envelope time in chunk ${record.chunkId}, stream ${record.stream}`,
    );
  const recordType = record.marker & 15;
  summary.recordTypes[recordType] = (summary.recordTypes[recordType] ?? 0) + 1;
  summary.envelopes++;
  envelopes++;
  summary.finalObservedSecondTimeSeconds = secondTime;
  summary.finalCandidateFirstTimeSeconds.float64 = accumulatedFloat64;
  summary.finalCandidateFirstTimeSeconds.float32 = accumulatedFloat32;
  if (
    Math.round(accumulatedFloat64 * 1000) !==
    Math.round(accumulatedFloat32 * 1000)
  )
    summary.differingCandidateMilliseconds++;
}

console.log(
  JSON.stringify(
    {
      build: replay.build,
      protocol: replay.protocol,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      footerDurationMilliseconds: replay.durationMilliseconds,
      declaredChunks: replay.declaredChunkCount,
      chunks,
      envelopes,
      streams,
    },
    null,
    2,
  ),
);
