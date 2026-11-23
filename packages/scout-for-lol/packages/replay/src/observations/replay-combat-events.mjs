// Scout-owned observation implementation; research paths re-export this module.
import { replayTimedPacketEnvelopes } from "./replay-packet-clock.mjs";
import { replayPacketEnvelopes } from "./transport.mjs";

const buildSet = new Set(["16.23.839.9929", "16.23.840.6595"]);
const protocol = "8bbfcd5af2bc92db";
const decoder = new TextDecoder("utf-8", { fatal: true });

function samePartitionCounts(actual, expected, start) {
  const signatures = (counts) =>
    counts
      .slice(start, start + 5)
      .map(([kills, deaths]) => `${kills}/${deaths}`)
      .sort();
  const expectedSignatures = signatures(expected);
  return signatures(actual).every(
    (value, index) => value === expectedSignatures[index],
  );
}

function footerCounts(replay) {
  const metadata = JSON.parse(
    decoder.decode(
      replay.bytes.subarray(replay.end + 256, replay.bytes.length - 4),
    ),
  );
  const rows = JSON.parse(metadata.statsJson);
  const readCount = (value) => {
    if (
      typeof value !== "string" ||
      !/^\d+$/.test(value) ||
      !Number.isSafeInteger(Number(value))
    )
      throw Error("Invalid replay combat count in the footer");
    return Number(value);
  };
  return rows.map((row) => [
    readCount(row.CHAMPIONS_KILLED),
    readCount(row.NUM_DEATHS),
  ]);
}

/** Verify observed kill/death packet cohorts while keeping context identities raw. */
export function decodeCombatEnvelopes(envelopes, expectedCounts) {
  if (expectedCounts.length !== 10)
    throw Error("Expected ten footer combat rows");
  const events = [];
  const opening = [];
  const counts = expectedCounts.map(() => [0, 0]);
  const moments = new Map();
  const clock = new DataView(new ArrayBuffer(4));
  let openingOffset;
  let context = 0;
  let opcode = null;
  for (const packet of envelopes) {
    const {
      stream,
      chunkOffset,
      blockOffset,
      explicitOpcode,
      marker,
      paramBits,
      payload,
      secondTimeBits,
      timeSeconds,
    } = packet;
    if (blockOffset === 0) {
      opcode = null;
      context = 0;
    }
    opcode = explicitOpcode ?? opcode;
    const delta = (paramBits << 24) >> 24;
    context = marker & 32 ? (context + delta) >>> 0 : paramBits;
    if (stream === 2 && openingOffset === undefined)
      openingOffset = chunkOffset;
    if (stream === 2 && chunkOffset === openingOffset && opcode === 313) {
      if (
        opening.length === 10 ||
        explicitOpcode !== 313 ||
        payload.length !== 1263 ||
        (marker & 32 && delta < 0)
      )
        throw Error("Invalid opening combat context envelope");
      opening.push({ context, partition: payload[1230] });
    }
    if (stream !== 1 || (opcode !== 172 && opcode !== 1183)) continue;
    const ordinal = context - opening[0]?.context;
    if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= 10) continue;
    const death = opcode === 172 && payload.length === 116;
    const kill = opcode === 172 && payload.length === 88;
    if (!kill && !death && opcode !== 1183) continue;
    let moment = moments.get(secondTimeBits);
    if (!moment) {
      clock.setUint32(0, secondTimeBits, true);
      const seconds = clock.getFloat32(0, true);
      if (!Number.isFinite(seconds) || seconds < 0)
        throw Error("Invalid secondary combat clock");
      moment = {
        earliest: timeSeconds,
        latest: timeSeconds,
        kills: [0, 0],
        deaths: [0, 0],
        corroboration: new Int32Array(10),
      };
      moments.set(secondTimeBits, moment);
    }
    moment.earliest = Math.min(moment.earliest, timeSeconds);
    moment.latest = Math.max(moment.latest, timeSeconds);
    if (opcode === 1183) {
      moment.corroboration[ordinal]--;
      continue;
    }
    const partition = ordinal < 5 ? 0 : 1;
    counts[ordinal][kill ? 0 : 1]++;
    if (kill) moment.kills[partition]++;
    else {
      moment.deaths[partition]++;
      moment.corroboration[ordinal]++;
    }
    events.push({
      kind: kill ? "champion-kill" : "champion-death",
      context,
      partition,
      timeSeconds,
      secondTimeBits,
    });
  }
  if (
    opening.length !== 10 ||
    opening[0].partition === opening[5].partition ||
    opening.some(
      ({ context, partition }, ordinal) =>
        context !== opening[0].context + ordinal ||
        partition !== opening[ordinal < 5 ? 0 : 5].partition,
    )
  )
    throw Error("Unverified opening combat context partition");
  if (
    !samePartitionCounts(counts, expectedCounts, 0) ||
    !samePartitionCounts(counts, expectedCounts, 5)
  )
    throw Error("Combat context totals differ from the footer totals");
  for (const {
    earliest,
    latest,
    kills,
    deaths,
    corroboration,
  } of moments.values()) {
    if (
      kills[0] > deaths[1] ||
      kills[1] > deaths[0] ||
      latest - earliest > 0.0010000001 ||
      corroboration.some((net) => net !== 0)
    )
      throw Error(
        "Combat packet cohort does not corroborate across the recorded clock",
      );
  }
  return events;
}

export function readReplayCombatEvents(replay, decompress) {
  if (!buildSet.has(replay.build) || replay.protocol !== protocol)
    throw Error("Unsupported combat event build or protocol");
  const teams = replay.roster.map(({ team }) => team);
  if (
    teams.length !== 10 ||
    teams[0] === teams[5] ||
    teams.some((team, index) => team !== teams[index < 5 ? 0 : 5])
  )
    throw Error("Expected two contiguous five-participant footer groups");
  return decodeCombatEnvelopes(
    replayTimedPacketEnvelopes(replayPacketEnvelopes(replay, decompress)),
    footerCounts(replay),
  );
}
