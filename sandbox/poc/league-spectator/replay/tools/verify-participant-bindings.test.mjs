import { expect, test } from "bun:test";
import { matchParticipantCombatProfiles } from "../replay-participant-bindings.mjs";

const opening = Array.from({ length: 10 }, (_, index) => 1000 + index);
const events = [
  { context: 1000, kind: "champion-kill", secondTimeBits: 50, timeSeconds: 5 },
  { context: 1005, kind: "champion-death", secondTimeBits: 50, timeSeconds: 5 },
];
const corroborated = [
  { opcode: 172, context: 1001, secondTimeBits: 50, timeSeconds: 5 },
  { opcode: 172, context: 1001, secondTimeBits: 50, timeSeconds: 5 },
  { opcode: 700, context: 1001, secondTimeBits: 50, timeSeconds: 5 },
];
const rows = Array.from({ length: 10 }, () => [0, 0, 0]);
rows[3] = [1, 0, 0];
rows[1] = [0, 0, 1];
rows[9] = [0, 1, 0];

test("unique signatures bind independently of row order without guessing ties", () => {
  expect(
    matchParticipantCombatProfiles(
      opening,
      events,
      [
        ...corroborated,
        { opcode: 172, context: 1009, secondTimeBits: 50 },
        { opcode: 172, context: 1002, secondTimeBits: 51 },
      ],
      rows,
    ),
  ).toEqual({
    verified: [
      { context: 1000, footerRow: 4 },
      { context: 1001, footerRow: 2 },
      { context: 1005, footerRow: 10 },
    ],
    unresolved: [1002, 1003, 1004, 1006, 1007, 1008, 1009],
    assists: [
      {
        kind: "champion-assist",
        context: 1001,
        partition: 0,
        timeSeconds: 5,
        secondTimeBits: 50,
      },
    ],
    assistEvents: 1,
  });
});

test("a shared secondary clock cannot hide distinct primary times", () => {
  const drift = 5.0001;
  expect(() =>
    matchParticipantCombatProfiles(
      opening,
      events,
      [...corroborated, { ...corroborated[2], timeSeconds: drift }],
      rows,
    ),
  ).toThrow("differs from the teammate kill primary clock");
  expect(() =>
    matchParticipantCombatProfiles(
      opening,
      [...events, { ...events[0], context: 1002, timeSeconds: drift }],
      corroborated,
      rows,
    ),
  ).toThrow("differs from the teammate kill primary clock");
});

test("requires corroboration at the same exact clock and exact footer totals", () => {
  expect(() =>
    matchParticipantCombatProfiles(
      opening,
      events,
      corroborated.slice(0, 2),
      rows,
    ),
  ).toThrow("Assist clocks do not corroborate");
  expect(() =>
    matchParticipantCombatProfiles(
      opening,
      events,
      corroborated,
      rows.map(() => [0, 0, 0]),
    ),
  ).toThrow("differ from the footer totals");
});

test("the current-build profile excludes only an exact concurrent own-kill witness", () => {
  const concurrentKill = { ...events[0], context: 1002 };
  const ownKillWitness = {
    opcode: 700,
    context: concurrentKill.context,
    secondTimeBits: concurrentKill.secondTimeBits,
    timeSeconds: concurrentKill.timeSeconds,
    payloadLength: 5,
  };
  const expected = rows.map((row) => [...row]);
  expected[2] = [1, 0, 0];
  const read = (packets, currentBuild = true) =>
    matchParticipantCombatProfiles(
      opening,
      [...events, concurrentKill],
      packets,
      expected,
      currentBuild,
    );
  expect(read([...corroborated, ownKillWitness]).assists).toEqual([
    expect.objectContaining({ context: 1001 }),
  ]);
  for (const witness of [
    { ...ownKillWitness, payloadLength: 4 },
    { ...ownKillWitness, context: 1003 },
  ])
    expect(() => read([...corroborated, witness])).toThrow(
      "Assist clocks do not corroborate",
    );
  expect(() => read([...corroborated, ownKillWitness, ownKillWitness])).toThrow(
    "Assist clocks do not corroborate",
  );
  expect(() => read([...corroborated, ownKillWitness], false)).toThrow(
    "Assist clocks do not corroborate",
  );
  expect(() => read([...corroborated.slice(0, 2), ownKillWitness])).toThrow(
    "Assist clocks do not corroborate",
  );
});
