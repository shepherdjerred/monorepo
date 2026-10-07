import { z } from "zod";
import wire from "#learning-setup-wire";
import duel from "#learning-wire";
import type { DuelState } from "#learning/duels.ts";

const vector = z.tuple([z.number(), z.number(), z.number()]);
const Fighter = z.strictObject({
  joinIndex: z.number().int().min(0).max(1),
  body: z.uuid(),
  personality: z.string().min(1),
  team: z.enum(["red", "blue"]),
  kit: z.literal("trooper"),
  position: vector,
  velocity: vector,
  yaw: z.number(),
  pitch: z.number(),
  health: z.literal(20),
  heldSlot: z.literal(1),
});
export const DuelSetup = z.strictObject({
  schema: z.literal(1),
  kind: z.literal("rwf-native-duel-setup"),
  match: z.uuid(),
  seed: z.number().int(),
  side: z.enum(["red", "blue"]),
  mode: z.enum(["authored", "external"]),
  opponent: z.enum(duel.opponents),
  map: z.literal("training-yard"),
  world: z.literal("minecraft:rwf"),
  worldTime: z.union([z.literal(0), z.literal(15_000)]),
  worldTick: z.number().int().nonnegative(),
  roster: z.array(Fighter).length(2),
});
export type DuelSetup = z.infer<typeof DuelSetup>;

if (
  JSON.stringify(wire) !==
  JSON.stringify({
    version: 1,
    kind: "rwf-native-duel-setup",
    map: "training-yard",
    world: "minecraft:rwf",
    worldTimes: [0, 15_000],
    kit: "trooper",
    health: 20,
    heldSlot: 1,
    velocity: [0, 0, 0],
    fields: Object.keys(DuelSetup.shape),
    fighter: Object.keys(Fighter.shape),
    spawns: [
      { team: "red", position: [25.5, 65, 8.5], yaw: -90, pitch: 0 },
      { team: "blue", position: [37.5, 65, 8.5], yaw: 90, pitch: 0 },
    ],
  })
)
  throw new Error("Native duel setup differs from its neutral contract");

export function validateSetup(raw: unknown, state: DuelState): DuelSetup {
  const setup = DuelSetup.parse(raw);
  if (
    setup.match !== state.match ||
    setup.seed !== state.seed ||
    setup.side !== state.side ||
    setup.mode !== state.mode ||
    setup.opponent !== state.opponent ||
    new Set(setup.roster.map((fighter) => fighter.body)).size !== 2 ||
    new Set(setup.roster.map((fighter) => fighter.personality)).size !== 2 ||
    new Set(setup.roster.map((fighter) => fighter.team)).size !== 2 ||
    setup.roster.find((fighter) => fighter.team === state.side)?.body !==
      state.body
  )
    throw new Error(
      "Original native setup differs from the duel identity or candidate body",
    );
  setup.roster.forEach((fighter, index) => {
    const spawn = wire.spawns.find((entry) => entry.team === fighter.team);
    if (
      spawn === undefined ||
      fighter.joinIndex !== index ||
      JSON.stringify(fighter.position) !== JSON.stringify(spawn.position) ||
      JSON.stringify(fighter.velocity) !== JSON.stringify(wire.velocity) ||
      fighter.yaw !== spawn.yaw ||
      fighter.pitch !== spawn.pitch
    )
      throw new Error(
        "Original native fighter spawn, velocity or join order changed",
      );
  });
  return setup;
}

export function pairedSetup(learned: DuelSetup, authored: DuelSetup): void {
  const stable = (setup: DuelSetup) => ({
    seed: setup.seed,
    side: setup.side,
    opponent: setup.opponent,
    map: setup.map,
    world: setup.world,
    worldTime: setup.worldTime,
    roster: setup.roster.map(({ body: _body, ...fighter }) => fighter),
  });
  if (
    learned.mode !== "external" ||
    authored.mode !== "authored" ||
    learned.match === authored.match ||
    learned.roster.some((left) =>
      authored.roster.some((right) => left.body === right.body),
    ) ||
    JSON.stringify(stable(learned)) !== JSON.stringify(stable(authored))
  )
    throw new Error(
      "Paired native duels use different environments or reused original bodies",
    );
}
