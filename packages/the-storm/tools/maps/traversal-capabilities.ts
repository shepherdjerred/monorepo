import { z } from "zod";

const expiry = z.number().int().min(-1);

export const TraversalCapabilities = z.strictObject({
  maySprint: z.boolean(),
  safeFallDistance: z.number().nonnegative(),
  fallDamageMultiplier: z.number().nonnegative(),
  fallProtectionPoints: z.number().int().min(0).max(20),
  resistanceAmplifier: z.number().int().min(-1),
  resistanceUntilTick: expiry,
  noFallUntilTick: expiry,
  slowFallingUntilTick: expiry,
  healingConsumables: z.number().int().nonnegative(),
  regenerationAmplifier: z.number().int().min(-1),
  regenerationUntilTick: expiry,
  jumpBoostAmplifier: z.number().int().min(-1),
  jumpBoostUntilTick: expiry,
  maxHealth: z.number().positive(),
  fallDistance: z.number().nonnegative(),
});
