import { z } from "zod";
import { BoxSchema } from "./bridge.ts";
import { ClientNameSchema } from "./client.ts";
export const CaptureResourceSchema = z.discriminatedUnion("resource", [
  z.strictObject({
    resource: z.literal("stargate-network"),
    id: z.string().regex(/^cap-[a-f0-9]{10}$/u),
  }),
  z.strictObject({
    resource: z.literal("shop-access"),
    id: z.enum(["true", "false"]),
  }),
]);
export const CaptureCleanupRequestSchema = z.union(
  CaptureResourceSchema.options.map((schema) =>
    schema.extend({ name: ClientNameSchema }),
  ),
);
export type CaptureResource = z.infer<typeof CaptureResourceSchema>;
export const CaptureInspectionSchema = z.strictObject({
  inspection: z.record(z.string(), z.string()),
});
export const PlayerCheckpointSchema = z.strictObject({
  moduleState: z.record(z.string(), z.string()),
  uuid: z.uuid(),
  name: z.string(),
  inventory: z.string().max(1_048_576),
  gameMode: z.enum(["SURVIVAL", "CREATIVE", "ADVENTURE", "SPECTATOR"]),
  health: z.number().nonnegative(),
  food: z.number().int().min(0).max(20),
  saturation: z.number().nonnegative(),
  exhaustion: z.number().nonnegative(),
  allowFlight: z.boolean(),
  flying: z.boolean(),
  flySpeed: z.number().min(-1).max(1),
  invulnerable: z.boolean(),
  fireTicks: z.number().int(),
  level: z.number().int().nonnegative(),
  exp: z.number().min(0).max(1),
  totalExp: z.number().int().nonnegative(),
  slot: z.number().int().min(0).max(8),
  effects: z.array(
    z.strictObject({
      type: z.string(),
      duration: z.number().int(),
      amplifier: z.number().int(),
      ambient: z.boolean(),
      particles: z.boolean(),
      icon: z.boolean(),
    }),
  ),
});
export const PlayerRestoreSchema = z.strictObject({
  checkpoint: PlayerCheckpointSchema,
  expectedInventory: z.string().max(1_048_576),
});
export const CaptureBoundedActionSchema = z.strictObject({
  box: BoxSchema,
  action: z.enum([
    "use",
    "attack",
    "input",
    "sign-write",
    "click",
    "screen-activate",
    "screen-type",
  ]),
  arguments: z.record(z.string(), z.unknown()),
});
