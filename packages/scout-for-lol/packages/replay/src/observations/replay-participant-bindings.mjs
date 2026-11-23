// Scout-owned observation implementation; research paths re-export this module.
import { decodeCombatEnvelopes } from "./replay-combat-events.mjs";
import { replayTimedPacketEnvelopes } from "./replay-packet-clock.mjs";
import { replayPacketEnvelopes } from "./transport.mjs";

const decoder = new TextDecoder("utf-8", { fatal: true });

function footerCombatStats(replay) {
  const input = replay.bytes.subarray(
    replay.end + 256,
    replay.bytes.length - 4,
  );
  const rows = JSON.parse(JSON.parse(decoder.decode(input)).statsJson);
  return rows.map((row) =>
    [row.CHAMPIONS_KILLED, row.NUM_DEATHS, row.ASSISTS].map((value) => {
      if (
        typeof value !== "string" ||
        !/^\d+$/.test(value) ||
        !Number.isSafeInteger(Number(value))
      )
        throw Error("Invalid footer K/D/A count");
      return Number(value);
    }),
  );
}

// Collect only the scalar evidence needed for assisted kills while the shared
// combat verifier validates the same underlying packet stream.
function* collectAssistEvidence(
  envelopes,
  opening,
  candidates,
  observeGameplayPacket,
) {
  let openingOffset;
  let opcode;
  let context;
  for (const packet of envelopes) {
    const {
      stream,
      blockOffset,
      chunkOffset,
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
    context =
      marker & 32 ? (context + ((paramBits << 24) >> 24)) >>> 0 : paramBits;
    if (stream === 2 && openingOffset === undefined)
      openingOffset = chunkOffset;
    if (stream === 2 && chunkOffset === openingOffset && explicitOpcode === 313)
      opening.push(context);
    if (
      stream === 1 &&
      (opcode === 700 || (opcode === 172 && payload.length === 44))
    )
      candidates.push({ opcode, context, secondTimeBits, timeSeconds });
    if (stream === 1) observeGameplayPacket?.(packet, opcode, context);
    yield packet;
  }
}

/** Bind only unique team-scoped signatures after the packet evidence agrees. */
export function matchParticipantCombatProfiles(
  opening,
  combatEvents,
  candidates,
  footerStats,
) {
  if (
    opening.length !== 10 ||
    new Set(opening).size !== 10 ||
    footerStats.length !== 10
  )
    throw Error("Expected ten distinct snapshot contexts and footer rows");
  const actorStats = new Map(
    opening.map((context, index) => [
      context,
      {
        team: Math.floor(index / 5),
        kills: 0,
        deaths: 0,
        assistClocks: new Map(),
        corroboratingClocks: new Set(),
      },
    ]),
  );
  const killClocks = new Map();
  for (const event of combatEvents) {
    const { context, kind, secondTimeBits } = event;
    const stats = actorStats.get(context);
    if (kind === "champion-death") {
      stats.deaths++;
      continue;
    }
    stats.kills++;
    const others = killClocks.get(secondTimeBits) ?? [];
    others.push(event);
    killClocks.set(secondTimeBits, others);
  }
  for (const { opcode, context, secondTimeBits, timeSeconds } of candidates) {
    const stats = actorStats.get(context);
    if (!stats) continue;
    const teammates = killClocks
      .get(secondTimeBits)
      ?.filter(
        (killer) =>
          killer.context !== context &&
          actorStats.get(killer.context).team === stats.team,
      );
    if (!teammates?.length) continue;
    if (
      !Number.isFinite(timeSeconds) ||
      timeSeconds < 0 ||
      teammates.some((killer) => killer.timeSeconds !== timeSeconds)
    )
      throw Error(
        "Assist evidence differs from the teammate kill primary clock",
      );
    if (opcode === 172) stats.assistClocks.set(secondTimeBits, timeSeconds);
    else stats.corroboratingClocks.add(secondTimeBits);
  }

  const verified = [];
  const unresolved = [];
  const expected = new Map();
  for (const [index, [k, d, a]] of footerStats.entries()) {
    const signature = [Math.floor(index / 5), k, d, a].join("/");
    const peers = expected.get(signature) ?? [];
    peers.push(index + 1);
    expected.set(signature, peers);
  }
  const actualCounts = new Map();
  const assists = [];
  for (const [
    context,
    { team, kills, deaths, assistClocks, corroboratingClocks },
  ] of actorStats) {
    if (
      assistClocks.size !== corroboratingClocks.size ||
      [...assistClocks.keys()].some((bits) => !corroboratingClocks.has(bits))
    )
      throw Error(
        "Assist clocks do not corroborate across opcodes 172 and 700",
      );
    for (const [secondTimeBits, timeSeconds] of assistClocks)
      assists.push({
        kind: "champion-assist",
        context,
        partition: team,
        timeSeconds,
        secondTimeBits,
      });
    const signature = [team, kills, deaths, assistClocks.size].join("/");
    const participants = expected.get(signature);
    if (!participants)
      throw Error("Combat signatures differ from the footer totals");
    actualCounts.set(signature, (actualCounts.get(signature) ?? 0) + 1);
    if (participants.length === 1)
      verified.push({ context, footerRow: participants[0] });
    else unresolved.push(context);
  }
  if (
    [...expected].some(
      ([signature, participants]) =>
        actualCounts.get(signature) !== participants.length,
    )
  )
    throw Error("Combat signatures differ from the footer totals");
  assists.sort(
    (a, b) => a.timeSeconds - b.timeSeconds || a.context - b.context,
  );
  return { verified, unresolved, assists, assistEvents: assists.length };
}

export function verifyReplayParticipantBindings(
  replay,
  decompress,
  { observeGameplayPacket, observeRawPacket } = {},
) {
  const teams = replay.roster.map(({ team }) => team);
  if (
    teams.length !== 10 ||
    teams[0] === teams[5] ||
    teams.some((team, index) => team !== teams[index < 5 ? 0 : 5])
  )
    throw Error("Expected two contiguous five-participant footer groups");
  const stats = footerCombatStats(replay);
  const opening = [];
  const candidates = [];
  function* envelopes() {
    for (const packet of replayPacketEnvelopes(replay, decompress)) {
      observeRawPacket?.(packet);
      yield packet;
    }
  }
  const evidence = collectAssistEvidence(
    replayTimedPacketEnvelopes(envelopes()),
    opening,
    candidates,
    observeGameplayPacket,
  );
  const events = decodeCombatEnvelopes(
    evidence,
    stats.map(([k, d]) => [k, d]),
  );
  return {
    ...matchParticipantCombatProfiles(opening, events, candidates, stats),
    events,
  };
}
