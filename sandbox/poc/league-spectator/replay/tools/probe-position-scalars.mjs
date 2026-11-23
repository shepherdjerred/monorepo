import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import { replayTimedPacketEnvelopes } from "../replay-packet-clock.mjs";
import { openReplay, replayPacketEnvelopes } from "../transport.mjs";
import { planPositionComparison } from "./research/compare-reference-positions.mjs";

// The observed 16.23 opcode that pairs gameplay and keyframe boundaries.
const keyframeBoundaryOpcode = 1167;

const formats = [
  ["getInt16", "i16-le", 2, true],
  ["getInt16", "i16-be", 2, false],
  ["getInt32", "i32-le", 4, true],
  ["getFloat32", "f32-le", 4, true],
];

function buildAnchors(identity, references) {
  const byTime = new Map();
  for (const reference of references) {
    const plan = planPositionComparison(identity, reference);
    if (plan.captureMethod !== "continuous")
      throw Error("Scalar probe requires continuous reference observations");
    const times = new Map(
      plan.sampleTimes.map(({ time }) => [
        time,
        {
          time,
          actors: new Map(),
          packetCount: 0,
          tracks: [new Map(), new Map()],
        },
      ]),
    );
    for (const sample of reference.samples) {
      const anchor = times.get(sample.time);
      if (anchor.actors.has(sample.key))
        throw Error("Overlapping reference time groups");
      anchor.actors.set(sample.key, [sample.position[0], sample.position[2]]);
    }
    for (const [time, anchor] of times) {
      if (byTime.has(time)) throw Error("Overlapping reference time groups");
      byTime.set(time, anchor);
    }
  }
  if (byTime.size < 5 || identity.participantCount < 2)
    throw Error(
      "Scalar probe requires at least five observation times and two actors",
    );
  return [...byTime.values()].sort((left, right) => left.time - right.time);
}

function selectPackets(anchors, timedRecords) {
  let opcode, signed, unsigned;
  for (const record of timedRecords) {
    if (record.stream !== 1) continue;
    if (record.blockOffset === 0) {
      opcode = null;
      signed = unsigned = 0;
    }
    if (record.explicitOpcode !== null) opcode = record.explicitOpcode;
    const { paramBits, marker, payload, timeSeconds } = record;
    signed =
      marker & 32 ? (signed + ((paramBits << 24) >> 24)) >>> 0 : paramBits;
    unsigned = marker & 32 ? (unsigned + paramBits) >>> 0 : paramBits;
    if (
      payload.length < 4 ||
      payload.length > 128 ||
      opcode === null ||
      opcode === keyframeBoundaryOpcode
    )
      continue;
    for (const anchor of anchors) {
      if (timeSeconds > anchor.time || timeSeconds < anchor.time - 2) continue;
      anchor.packetCount++;
      anchor.tracks[0].set(`${opcode}/${payload.length}/${signed}`, payload);
      anchor.tracks[1].set(`${opcode}/${payload.length}/${unsigned}`, payload);
    }
  }
}

function fitHypotheses(anchors, mode, participantCount) {
  let recurringTracks = 0,
    tracksWithCoverage = 0,
    tested = 0,
    matched = 0,
    shiftedMatched = 0;
  const candidates = [];
  for (const [key, first] of anchors[0].tracks[mode]) {
    if (!anchors[1].tracks[mode].has(key)) continue;
    recurringTracks++;
    const payloads = anchors.map(({ tracks }) => tracks[mode].get(key));
    const heldOutCount = payloads.slice(2).filter(Boolean).length;
    if (heldOutCount < 3) continue;
    tracksWithCoverage++;
    const views = payloads.map(
      (payload) =>
        payload &&
        new DataView(payload.buffer, payload.byteOffset, payload.byteLength),
    );
    for (const [read, format, width, littleEndian] of formats) {
      for (const stride of [width, width * 2]) {
        for (
          let offset = 0;
          offset + stride + width <= first.length;
          offset++
        ) {
          const raw = views.map(
            (view) =>
              view && [
                view[read](offset, littleEndian),
                view[read](offset + stride, littleEndian),
              ],
          );
          if (
            ![...raw[0], ...raw[1]].every(Number.isFinite) ||
            raw[0][0] === raw[1][0] ||
            raw[0][1] === raw[1][1]
          )
            continue;
          for (const [actor, start] of anchors[0].actors) {
            const end = anchors[1].actors.get(actor);
            const delta = end.map((value, axis) => value - start[axis]);
            if (delta.some((value) => Math.abs(value) < 60)) continue;
            const scales = delta.map(
              (value, axis) => value / (raw[1][axis] - raw[0][axis]),
            );
            const ratio =
              Math.max(...scales.map(Math.abs)) /
              Math.min(...scales.map(Math.abs));
            if (!Number.isFinite(ratio) || ratio > 1.1) continue;
            const maximumError = (heldOutActor) =>
              Math.max(
                ...raw.slice(2).map((point, index) => {
                  if (!point) return 0;
                  const observed = anchors[index + 2].actors.get(heldOutActor);
                  return Math.hypot(
                    ...point.map(
                      (value, axis) =>
                        start[axis] +
                        (value - raw[0][axis]) * scales[axis] -
                        observed[axis],
                    ),
                  );
                }),
              );
            const error = maximumError(actor);
            const shiftedError = maximumError((actor % participantCount) + 1);
            tested++;
            if (shiftedError <= 25) shiftedMatched++;
            if (error > 25 || !Number.isFinite(error)) continue;
            matched++;
            if (candidates.length < 32)
              candidates.push({
                key,
                actor,
                format,
                offset,
                stride,
                heldOutCount,
                maximumPlanarError: error,
                shiftedActorMatched: shiftedError <= 25,
              });
          }
        }
      }
    }
  }
  return {
    recurringTracks,
    tracksWithCoverage,
    tested,
    matched,
    shiftedMatched,
    candidates,
  };
}

/** Test a bounded scalar-position hypothesis. Matches are candidates only. */
export function probePositionScalars(identity, references, timedRecords) {
  const anchors = buildAnchors(identity, references);
  selectPackets(anchors, timedRecords);
  return {
    replaySha256: identity.replaySha256,
    build: identity.build,
    protocol: identity.protocol,
    anchors: anchors.map(({ time, packetCount }, index) => ({
      time,
      packetCount,
      split: index < 2 ? "calibration" : "held-out",
    })),
    hypotheses: {
      signed: fitHypotheses(anchors, 0, identity.participantCount),
      unsigned: fitHypotheses(anchors, 1, identity.participantCount),
    },
  };
}

if (import.meta.main) {
  const [path, ...receipts] = process.argv.slice(2);
  if (!path || receipts.length === 0)
    throw Error(
      "Usage: node probe-position-scalars.mjs <replay.rofl> <continuous-reference.json> [...]",
    );
  const bytes = readFileSync(path);
  const replay = openReplay(new Uint8Array(bytes).buffer);
  const identity = {
    replaySha256: createHash("sha256").update(bytes).digest("hex"),
    build: replay.build,
    protocol: replay.protocol,
    durationMilliseconds: replay.durationMilliseconds,
    participantCount: replay.roster.length,
  };
  const references = receipts.map((receipt) =>
    JSON.parse(readFileSync(receipt, "utf8")),
  );
  const records = replayPacketEnvelopes(replay, (stored, target) =>
    zstdDecompressSync(stored, { maxOutputLength: target.byteLength }),
  );
  console.log(
    JSON.stringify(
      probePositionScalars(
        identity,
        references,
        replayTimedPacketEnvelopes(records),
      ),
      null,
      2,
    ),
  );
}
