import { z } from "zod";

const Vec3Schema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  z: z.number().int(),
});

/**
 * The bridge `/v1/regions/read` response as this package consumes it. The
 * strict wire contract lives in @shepherdjerred/mc-harness/protocol/bridge.ts.
 */
export const RegionReadSchema = z.object({
  world: z.string(),
  min: Vec3Schema,
  max: Vec3Schema,
  size: Vec3Schema,
  palette: z.array(z.string()),
  blocks: z.string(),
  blockEntities: z.array(z.object({ pos: Vec3Schema, id: z.string() })),
});
export type RegionRead = z.infer<typeof RegionReadSchema>;
