import { z } from "zod";

export const SetRuntimeSchema = z.strictObject({
  mode: z.enum(["active", "observe"]),
  expectedVersion: z.int().nonnegative(),
});

export const RuntimeStateSchema = z.strictObject({
  mode: z.enum(["active", "observe"]),
  recoveryEpoch: z.int().nonnegative(),
  ownershipConfirmed: z.boolean(),
  version: z.int().nonnegative(),
});
