import { expect, test } from "bun:test";
import {
  DragonKillEvidenceError,
  reconcileDragonKillCohorts,
} from "./recorded-dragon-kills.mjs";

const actor = 0x40000001;
const subject = 0x40001234;
const clock = 0x43d78000;
const binding = {
  verified: [{ context: actor, footerRow: 7 }],
  unresolved: [],
};
const counts = Array.from({ length: 10 }, (_, index) => Number(index === 6));

function record(opcode, context, bytes, secondTimeBits = clock) {
  return { opcode, context, payload: Uint8Array.from(bytes), secondTimeBits };
}

function cohort() {
  return {
    timeSeconds: 431,
    records: [
      record(671, 0, [...new Array(13).fill(0), 0xc9]),
      record(702, 0, [...new Array(17).fill(0), 0xd5]),
      record(1076, 0, [...new Array(9).fill(0), 0x47]),
      record(209, subject, [0xbf]),
      record(260, subject, [0x7b]),
      record(729, subject, [0xe4, 0x11]),
      record(257, actor, [0x0f, 0x73, 0xad]),
      record(
        270,
        actor,
        [0x10, 0x50, 0xac, 0x7b, 0x3b, 0x3b, 0x0e, 0xb7, 0x86, 0xee],
      ),
      record(270, actor, [0x16, 0x51, 0xac, 0x7b, 0x86, 0xee]),
      record(682, 0x40004000, [0x03, 0x73, 0xad]),
    ],
  };
}

test("publishes the reconciled subject and independently bound actor at the recorded clock", () => {
  expect(reconcileDragonKillCohorts([cohort()], binding, counts, 900)).toEqual({
    status: "observed",
    events: [
      {
        timeSeconds: 431,
        secondTimeBits: clock,
        actorContext: actor,
        footerRow: 7,
        subjectContext: subject,
      },
    ],
  });
});

test("reports absence only when no candidate and no footer kills exist", () => {
  expect(
    reconcileDragonKillCohorts([], binding, Array(10).fill(0), 76),
  ).toEqual({
    status: "absent",
    events: [],
  });
  expect(() => reconcileDragonKillCohorts([], binding, counts, 900)).toThrow(
    "counts differ from the footer",
  );
});

test("rejects incomplete notice families, duplicate notice, and a displaced secondary clock", () => {
  const intact = cohort();
  for (const records of [
    intact.records.filter(({ opcode }) => opcode !== 702),
    [...intact.records, intact.records[0]],
    intact.records.map((item) =>
      item.opcode === 1076 ? { ...item, secondTimeBits: clock + 1 } : item,
    ),
  ]) {
    expect(() =>
      reconcileDragonKillCohorts(
        [{ ...intact, records }],
        binding,
        counts,
        900,
      ),
    ).toThrow(DragonKillEvidenceError);
  }
});

test("rejects competing subjects, uncorroborated actions and unresolved participant rows", () => {
  const intact = cohort();
  const competingSubject = record(260, subject + 1, [0x7b]);
  const competingActor = record(257, actor + 1, [0x0f, 0x73, 0xad]);
  const alternatives = [
    { records: [...intact.records, competingSubject], binding },
    {
      records: [...intact.records, competingActor],
      binding: { ...binding, unresolved: [actor + 1] },
    },
    { records: intact.records.filter(({ opcode }) => opcode !== 729), binding },
    { records: intact.records.filter(({ opcode }) => opcode !== 682), binding },
    { records: intact.records, binding: { verified: [], unresolved: [actor] } },
  ];
  for (const alternative of alternatives) {
    expect(() =>
      reconcileDragonKillCohorts(
        [{ ...intact, records: alternative.records }],
        alternative.binding,
        counts,
        900,
      ),
    ).toThrow(DragonKillEvidenceError);
  }
});

test("rejects same-total counts assigned to a different footer row", () => {
  const displaced = counts.toReversed();
  expect(() =>
    reconcileDragonKillCohorts([cohort()], binding, displaced, 900),
  ).toThrow("counts differ from the footer");
});
