import { expect, test } from "vitest";
import { validateSetup, pairedSetup } from "./setup.ts";
import { DuelStateSchema } from "#learning/duels.ts";
import wire from "#learning-wire";

function fixture(external: boolean) {
  const match = external
    ? "11111111-1111-4111-8111-111111111111"
    : "22222222-2222-4222-8222-222222222222";
  const bodies = external
    ? [
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ]
    : [
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      ];
  const mode = external ? "external" : "authored";
  const state = DuelStateSchema.parse({
    protocol: wire.version,
    contract: wire.contract,
    seed: 17,
    side: "red",
    mode,
    opponent: "authored",
    result: "loss",
    phase: "ENDED",
    match,
    body: bodies[0],
    dealt: 0,
    received: 20,
    sampleDealt: 0,
    sampleReceived: 20,
    sampleTick: 22,
    used: [],
    applied: Number(external),
    fallback: 0,
  });
  const setup = {
    schema: 1,
    kind: "rwf-native-duel-setup",
    match,
    seed: 17,
    side: "red",
    mode,
    opponent: "authored",
    map: "training-yard",
    world: "minecraft:rwf",
    worldTime: 0,
    worldTick: external ? 50 : 800,
    roster: [
      {
        joinIndex: 0,
        body: bodies[0],
        personality: "unit-first",
        team: "red",
        kit: "trooper",
        position: [25.5, 65, 8.5],
        velocity: [0, 0, 0],
        yaw: -90,
        pitch: 0,
        health: 20,
        heldSlot: 1,
      },
      {
        joinIndex: 1,
        body: bodies[1],
        personality: "unit-second",
        team: "blue",
        kit: "trooper",
        position: [37.5, 65, 8.5],
        velocity: [0, 0, 0],
        yaw: 90,
        pitch: 0,
        health: 20,
        heldSlot: 1,
      },
    ],
  };
  return { state, setup };
}

test("paired setup retains stable personalities, teams, kits and starting conditions with fresh native identities", () => {
  const learned = fixture(true);
  const authored = fixture(false);
  expect(() =>
    pairedSetup(
      validateSetup(learned.setup, learned.state),
      validateSetup(authored.setup, authored.state),
    ),
  ).not.toThrow();
});

test("rejects changed candidate identities, duplicate bodies, join order and altered native spawn conditions", () => {
  const input = fixture(true);
  const first = input.setup.roster[0];
  const second = input.setup.roster[1];
  if (first === undefined || second === undefined)
    throw new Error("Missing unit fighter");
  for (const altered of [
    { ...input.setup, seed: 18 },
    { ...input.setup, match: fixture(false).setup.match },
    { ...input.setup, roster: [second, first] },
    { ...input.setup, roster: [first, { ...second, body: first.body }] },
    { ...input.setup, roster: [{ ...first, position: [26, 65, 8.5] }, second] },
    { ...input.setup, roster: [{ ...first, velocity: [0.1, 0, 0] }, second] },
    { ...input.setup, roster: [{ ...first, kit: "archer" }, second] },
    { ...input.setup, roster: [{ ...first, health: 19 }, second] },
  ])
    expect(() => validateSetup(altered, input.state)).toThrow();
});

test("refuses different paired lighting or personalities and reused original match/body identities", () => {
  const left = fixture(true);
  const right = fixture(false);
  const learned = validateSetup(left.setup, left.state);
  const authored = validateSetup(right.setup, right.state);
  expect(() =>
    pairedSetup(learned, { ...authored, worldTime: 15_000 }),
  ).toThrow("environments");
  expect(() =>
    pairedSetup(learned, { ...authored, match: learned.match }),
  ).toThrow("environments");
  expect(() =>
    pairedSetup(learned, { ...authored, roster: learned.roster }),
  ).toThrow("environments");
  const first = authored.roster[0];
  if (first === undefined) throw new Error("Missing unit fighter");
  expect(() =>
    pairedSetup(learned, {
      ...authored,
      roster: [
        { ...first, personality: "changed" },
        ...authored.roster.slice(1),
      ],
    }),
  ).toThrow("environments");
});
