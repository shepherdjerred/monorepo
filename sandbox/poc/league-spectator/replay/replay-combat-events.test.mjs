import { expect, test } from "bun:test";
import { decodeCombatEnvelopes } from "./replay-combat-events.mjs";

const base = 1000;
const clock = 0x42936741;

function packet(
  stream,
  blockOffset,
  explicitOpcode,
  length,
  context,
  compact = false,
  secondTimeBits = clock,
) {
  const payload = new Uint8Array(length);
  if (stream === 2) payload[1230] = context < base + 5 ? 0x10 : 0x20;
  return {
    stream,
    chunkOffset: stream === 2 ? 20 : 500,
    blockOffset,
    explicitOpcode,
    payload,
    paramBits: context,
    marker: compact ? 33 : 1,
    timeSeconds: stream === 2 ? 0 : 60,
    secondTimeBits,
  };
}

const opening = Array.from({ length: 10 }, (_, index) =>
  packet(2, index * 1300, 313, 1263, base + index),
);
const kill = packet(1, 0, 172, 88, base);
const decoy = packet(1, 100, 172, 116, base + 128);
const death = packet(1, 230, null, 116, 133, true);
const corroboration = packet(1, 360, 1183, 16, base + 5);

function footer(killed, died) {
  return Array.from({ length: 10 }, (_, index) => [
    Number(index === killed),
    Number(index === died),
  ]);
}

test("recognizes the signed-context combat cohort and retains packet order", () => {
  expect(
    decodeCombatEnvelopes(
      [...opening, kill, decoy, death, corroboration],
      footer(0, 5),
    ),
  ).toEqual([
    {
      kind: "champion-kill",
      context: base,
      partition: 0,
      timeSeconds: 60,
      secondTimeBits: clock,
    },
    {
      kind: "champion-death",
      context: base + 5,
      partition: 1,
      timeSeconds: 60,
      secondTimeBits: clock,
    },
  ]);
});

test("retains corroborated deaths with no recorded opposing kill", () => {
  const events = decodeCombatEnvelopes(
    [...opening, decoy, death, corroboration],
    footer(null, 5),
  );
  expect(events.map(({ kind }) => kind)).toEqual(["champion-death"]);
});

test("requires independent corroboration, an opposing death for each kill, and footer totals", () => {
  expect(() =>
    decodeCombatEnvelopes([...opening, kill, decoy, death], footer(0, 5)),
  ).toThrow("does not corroborate");
  expect(() =>
    decodeCombatEnvelopes(
      [
        ...opening,
        kill,
        decoy,
        death,
        { ...corroboration, secondTimeBits: clock + 1 },
      ],
      footer(0, 5),
    ),
  ).toThrow("does not corroborate");
  expect(() =>
    decodeCombatEnvelopes([...opening, kill], footer(0, null)),
  ).toThrow("does not corroborate");
  expect(() =>
    decodeCombatEnvelopes(
      [...opening, kill, decoy, death, corroboration],
      footer(5, 5),
    ),
  ).toThrow("differ from the footer totals");
});

test("matches partition signatures without assuming the footer row order", () => {
  const events = decodeCombatEnvelopes(
    [...opening, kill, decoy, death, corroboration],
    footer(4, 8),
  );
  expect(events.map(({ context }) => context)).toEqual([base, base + 5]);
  expect(() =>
    decodeCombatEnvelopes(
      [
        ...opening,
        kill,
        decoy,
        death,
        { ...corroboration, timeSeconds: 60.002 },
      ],
      footer(4, 8),
    ),
  ).toThrow("does not corroborate");
});
