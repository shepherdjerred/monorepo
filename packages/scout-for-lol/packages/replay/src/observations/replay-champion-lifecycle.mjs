// Scout-owned observation implementation; research paths re-export this module.
import { verifyReplayParticipantBindings } from "./replay-participant-bindings.mjs";

const decoder = new TextDecoder("utf-8", { fatal: true });

export class ChampionReturnValidationError extends Error {
  name = "ChampionReturnValidationError";
}

function footerCombatLifetimes(replay) {
  const bytes = replay.bytes.subarray(
    replay.end + 256,
    replay.bytes.length - 4,
  );
  const rows = JSON.parse(JSON.parse(decoder.decode(bytes)).statsJson);
  const readCount = (value) => {
    if (
      typeof value !== "string" ||
      !/^\d+$/.test(value) ||
      !Number.isSafeInteger(Number(value))
    )
      throw new ChampionReturnValidationError(
        "Invalid death count or completed dead time in the replay footer",
      );
    return Number(value);
  };
  return {
    expectedSeconds: rows.map(({ TOTAL_TIME_SPENT_DEAD }) =>
      readCount(TOTAL_TIME_SPENT_DEAD),
    ),
    deathCount: rows.reduce(
      (total, { NUM_DEATHS }) => total + readCount(NUM_DEATHS),
      0,
    ),
  };
}

/** Require independent actor bindings and the complete dead-time accounting. */
export function validateChampionReturns(
  { events, verified },
  candidates,
  expectedSeconds,
  duration,
) {
  const owners = new Map(
    verified.map(({ context, footerRow }) => [
      context,
      {
        expected: expectedSeconds[footerRow - 1],
        deaths: [],
        completed: 0,
        total: 0,
      },
    ]),
  );
  const boundRows = new Set(verified.map(({ footerRow }) => footerRow));
  if (
    expectedSeconds.some(
      (seconds, index) => seconds !== 0 && !boundRows.has(index + 1),
    )
  )
    throw new ChampionReturnValidationError(
      "Replay dead time includes an unbound actor",
    );
  for (const event of events) {
    if (event.kind !== "champion-death") continue;
    const owner = owners.get(event.context);
    if (!owner)
      throw new ChampionReturnValidationError(
        "Replay death has no verified actor binding",
      );
    owner.deaths.push(event);
  }

  const returns = [];
  for (const {
    context,
    timeSeconds,
    secondTimeBits,
    payloadBytes,
  } of candidates) {
    if (payloadBytes !== 9 && payloadBytes !== 13)
      throw new ChampionReturnValidationError(
        "Unverified champion-return envelope width",
      );
    const owner = owners.get(context);
    const death = owner?.deaths[owner.completed];
    if (!owner || !death)
      throw new ChampionReturnValidationError(
        "Champion-return packet has no unpaired verified death",
      );
    const next = owner.deaths[owner.completed + 1];
    if (
      !Number.isFinite(timeSeconds) ||
      timeSeconds <= death.timeSeconds ||
      timeSeconds > duration ||
      (next && timeSeconds >= next.timeSeconds)
    )
      throw new ChampionReturnValidationError(
        "Champion-return clock is outside its verified death interval",
      );
    owner.total += timeSeconds - death.timeSeconds;
    owner.completed++;
    returns.push({
      kind: "champion-return",
      context,
      partition: death.partition,
      timeSeconds,
      secondTimeBits,
    });
  }
  for (const { deaths, completed, total, expected } of owners.values()) {
    if (deaths.length - completed > 1)
      throw new ChampionReturnValidationError(
        "A nonterminal verified death has no champion-return packet",
      );
    if (Math.floor(total) !== expected)
      throw new ChampionReturnValidationError(
        "Verified champion-return intervals disagree with footer dead time",
      );
  }
  return returns;
}

export function createChampionReturnObserver(replay) {
  const { expectedSeconds, deathCount } = footerCombatLifetimes(replay);
  if (!Number.isSafeInteger(deathCount))
    throw new ChampionReturnValidationError("Invalid total replay death count");
  const candidates = [];
  return {
    observeGameplayPacket(packet, opcode, context) {
      if (opcode !== 1098) return;
      if (candidates.length >= deathCount)
        throw new ChampionReturnValidationError(
          "Champion-return packet count exceeds footer deaths",
        );
      const { timeSeconds, secondTimeBits, payload } = packet;
      candidates.push({
        context,
        timeSeconds,
        secondTimeBits,
        payloadBytes: payload.length,
      });
    },
    finish(combat) {
      return validateChampionReturns(
        combat,
        candidates,
        expectedSeconds,
        replay.duration,
      );
    },
  };
}

export function readReplayChampionLifecycle(replay, decompress) {
  const observer = createChampionReturnObserver(replay);
  const combat = verifyReplayParticipantBindings(replay, decompress, observer);
  return { ...combat, returns: observer.finish(combat) };
}
