import { openReplay } from "../../transport.mjs";
import { verifyReplayParticipantBindings } from "../../replay-participant-bindings.mjs";

const build = "16.23.840.6595";
const protocol = "8bbfcd5af2bc92db";
const decoder = new TextDecoder("utf-8", { fatal: true });

export class DragonKillEvidenceError extends Error {}

function readExpectedCounts(replay) {
  const metadata = JSON.parse(
    decoder.decode(replay.bytes.subarray(replay.end + 256, -4)),
  );
  const rows = JSON.parse(metadata.statsJson);
  if (!Array.isArray(rows) || rows.length !== 10)
    throw new DragonKillEvidenceError("Expected ten dragon count rows");
  return rows.map(({ DRAGON_KILLS: count, ELDER_DRAGON_KILLS: elder }) => {
    if (
      typeof count !== "string" ||
      !/^\d+$/.test(count) ||
      !Number.isSafeInteger(Number(count)) ||
      elder !== "0"
    )
      throw new DragonKillEvidenceError(
        "Unsupported dragon count in replay footer",
      );
    return Number(count);
  });
}

function hasBytes(payload, ...values) {
  return (
    payload.length === values.length &&
    values.every((value, index) => payload[index] === value)
  );
}

function globalSignature({ opcode, payload, context }) {
  if (context !== 0) return null;
  const last = payload.at(-1);
  if (opcode === 671 && payload.length === 14 && last === 0xc9) return "notice";
  if (opcode === 702 && [18, 20].includes(payload.length) && last === 0xd5)
    return "announcement";
  if (opcode === 1076 && payload.length === 10 && last === 0x47)
    return "summary";
  return null;
}

function sameTail(first, second) {
  return (
    first.length === second.length &&
    first.subarray(1).every((byte, offset) => byte === second[offset + 1])
  );
}

function pairedActorAction(records, context) {
  const actions = records.filter(
    (record) => record.opcode === 270 && record.context === context,
  );
  const pairs = actions.flatMap(({ payload: long }) =>
    actions.filter(
      ({ payload: short }) =>
        [10, 11].includes(long.length) &&
        short.length === long.length - 4 &&
        long
          .subarray(2, short.length - 2)
          .every((byte, offset) => byte === short[offset + 2]) &&
        long.at(-2) === short.at(-2) &&
        long.at(-1) === short.at(-1),
    ),
  );
  return pairs.length === 1;
}

export function reconcileDragonKillCohorts(cohorts, binding, counts, duration) {
  const verified = new Map(
    binding.verified.map(({ context, footerRow }) => [context, footerRow]),
  );
  const roster = new Set([...verified.keys(), ...binding.unresolved]);
  const totals = counts.map(() => 0);
  const subjects = new Set();
  const secondaryClocks = new Set();
  const events = [];
  for (const { timeSeconds, records } of cohorts) {
    const notice = records.filter(
      (record) => globalSignature(record) === "notice",
    );
    const announcement = records.filter(
      (record) => globalSignature(record) === "announcement",
    );
    const summary = records.filter(
      (record) => globalSignature(record) === "summary",
    );
    const secondTimeBits = notice[0]?.secondTimeBits;
    if (
      notice.length !== 1 ||
      announcement.length !== 1 ||
      ![1, 2].includes(summary.length) ||
      ![...announcement, ...summary].every(
        (record) => record.secondTimeBits === secondTimeBits,
      ) ||
      !Number.isFinite(timeSeconds) ||
      timeSeconds < 0 ||
      timeSeconds > duration ||
      secondaryClocks.has(secondTimeBits)
    )
      throw new DragonKillEvidenceError(
        "Ambiguous dragon kill notices or clocks",
      );

    const synchronized = records.filter(
      (record) => record.secondTimeBits === secondTimeBits,
    );
    const deaths = synchronized.filter(
      ({ opcode, payload, context }) =>
        opcode === 260 &&
        hasBytes(payload, 0x7b) &&
        context !== 0 &&
        !roster.has(context),
    );
    if (deaths.length !== 1)
      throw new DragonKillEvidenceError("Ambiguous dragon kill subject");
    const subjectContext = deaths[0].context;
    const witnesses = [
      [209, [0xbf]],
      [729, [0xe4, 0x11]],
    ];
    if (
      subjects.has(subjectContext) ||
      !witnesses.every(
        ([opcode, bytes]) =>
          synchronized.filter(
            (record) =>
              record.opcode === opcode &&
              record.context === subjectContext &&
              hasBytes(record.payload, ...bytes),
          ).length === 1,
      )
    )
      throw new DragonKillEvidenceError(
        "Missing distinct dragon kill subject witnesses",
      );

    const actors = synchronized.filter(
      ({ opcode, payload, context }) =>
        opcode === 257 &&
        [3, 4].includes(payload.length) &&
        roster.has(context),
    );
    if (
      actors.length !== 1 ||
      !verified.has(actors[0].context) ||
      !pairedActorAction(synchronized, actors[0].context) ||
      synchronized.filter(
        ({ opcode, payload, context }) =>
          opcode === 682 &&
          context !== 0 &&
          !roster.has(context) &&
          sameTail(actors[0].payload, payload),
      ).length !== 1
    )
      throw new DragonKillEvidenceError(
        "Ambiguous dragon kill actor or corroboration",
      );
    const actorContext = actors[0].context;
    const footerRow = verified.get(actorContext);
    if (
      !Number.isInteger(footerRow) ||
      footerRow < 1 ||
      footerRow > counts.length
    )
      throw new DragonKillEvidenceError("Invalid dragon kill actor footer row");

    totals[footerRow - 1]++;
    secondaryClocks.add(secondTimeBits);
    subjects.add(subjectContext);
    events.push({
      timeSeconds,
      secondTimeBits,
      actorContext,
      footerRow,
      subjectContext,
    });
  }

  if (counts.some((count, index) => count !== totals[index]))
    throw new DragonKillEvidenceError(
      "Dragon kill packet counts differ from the footer",
    );
  return { status: events.length ? "observed" : "absent", events };
}

/** Research-only observer for the calibrated build. Evidence mismatches throw. */
export function decodeRecordedDragonKills(buffer, decompress) {
  const replay = openReplay(buffer);
  if (replay.build !== build || replay.protocol !== protocol)
    throw new DragonKillEvidenceError(
      "Unsupported dragon kill build or protocol",
    );
  const counts = readExpectedCounts(replay);
  const cohorts = [];
  let cohort;
  function finishCohort() {
    if (cohort?.records.some(globalSignature)) cohorts.push(cohort);
  }
  const binding = verifyReplayParticipantBindings(replay, decompress, {
    observeGameplayPacket(
      { timeSeconds, secondTimeBits, payload },
      opcode,
      context,
    ) {
      if (![209, 257, 260, 270, 671, 682, 702, 729, 1076].includes(opcode))
        return;
      if (cohort?.timeSeconds !== timeSeconds) {
        finishCohort();
        cohort = { timeSeconds, records: [] };
      }
      cohort.records.push({ opcode, context, secondTimeBits, payload });
    },
  });
  finishCohort();
  return reconcileDragonKillCohorts(cohorts, binding, counts, replay.duration);
}
