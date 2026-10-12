import { z } from "zod";
import wire from "#learning-melee-wire";

const Scalar = z.number();
const Count = z.number().int().nonnegative();
export const MeleeBody = z.strictObject({
  body: z.uuid(),
  x: Scalar,
  y: Scalar,
  z: Scalar,
  yaw: Scalar,
  pitch: Scalar,
  health: Scalar.min(0).max(20),
  absorption: Scalar.nonnegative(),
  velocityX: Scalar,
  velocityY: Scalar,
  velocityZ: Scalar,
  heldSlot: Count.max(8),
  weapon: z.string().min(1),
  knockbackLevel: Count,
  sprinting: z.boolean(),
  gameMode: z.enum(["SURVIVAL", "ADVENTURE", "CREATIVE", "SPECTATOR"]),
  invulnerable: z.boolean(),
});
export type MeleeBody = z.infer<typeof MeleeBody>;
export const MeleeProbe = z.strictObject({
  protocol: z.literal(wire.version),
  contract: z.literal(wire.contract),
  match: z.uuid(),
  phase: z.literal("LIVE"),
  world: z.literal(wire.world),
  serverTick: Count,
  trial: z.enum(wire.trials),
  attackerBefore: MeleeBody,
  victimBefore: MeleeBody,
  attackerAfter: MeleeBody,
  victimAfter: MeleeBody,
  reachable: z.boolean(),
  visible: z.boolean(),
  wallBefore: z.array(z.string().min(1)).length(2),
  wallDuring: z.array(z.string().min(1)).length(2),
  wallAfter: z.array(z.string().min(1)).length(2),
  refusal: z.string(),
});
export type MeleeProbe = z.infer<typeof MeleeProbe>;

if (
  wire.version !== 1 ||
  wire.contract !== "rwf-native-melee-check-v1" ||
  wire.reach !== 3 ||
  JSON.stringify(wire.trials) !== JSON.stringify(["blocked", "clear"]) ||
  JSON.stringify(Object.keys(MeleeProbe.shape)) !==
    JSON.stringify(wire.fields) ||
  JSON.stringify(Object.keys(MeleeBody.shape)) !==
    JSON.stringify(wire.bodyFields)
)
  throw new Error("Native melee contract incompatible");
z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()]).parse(
  wire.attacker,
);
z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()]).parse(
  wire.victim,
);
z.array(z.tuple([z.number().int(), z.number().int(), z.number().int()]))
  .length(2)
  .parse(wire.wall);
