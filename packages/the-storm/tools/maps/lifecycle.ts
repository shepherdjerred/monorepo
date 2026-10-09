import { z } from "zod";

const point = z.strictObject({
  x: z.number().int(),
  y: z.number().int(),
  z: z.number().int(),
});
export const Lifecycle = z.strictObject({
  maps: z
    .array(
      z.strictObject({
        id: z.string(),
        region: z.strictObject({ min: point, max: point }),
        blocksSha256: z.string(),
        decoded: z.boolean(),
        busy: z.boolean(),
        ready: z.boolean(),
        heldChunks: z.number().int().nonnegative(),
        preparations: z.number().int().nonnegative(),
        releases: z.number().int().nonnegative(),
      }),
    )
    .min(3),
  navigation: z.array(z.string()),
  heapUsed: z.number().nonnegative(),
  heapMax: z.number().positive(),
  tick: z.number().int(),
  tickTimes: z.array(z.number().nonnegative()),
  loadedChunks: z.record(z.string(), z.number().int().nonnegative()),
});
export type Lifecycle = z.infer<typeof Lifecycle>;

export function verifyBounds(snapshot: Lifecycle): void {
  const decoded = snapshot.maps.filter((map) => map.decoded);
  const preparing = snapshot.maps.filter((map) => map.busy || map.decoded);
  const ticketed = snapshot.maps.filter((map) => map.heldChunks > 0);
  if (
    decoded.length > 2 ||
    preparing.length > 2 ||
    ticketed.length > 2 ||
    snapshot.navigation.length > 2
  )
    throw new Error(
      "Lazy map bound exceeded: active map plus at most one successor",
    );
  if (
    new Set(snapshot.maps.map((map) => map.id)).size !== snapshot.maps.length ||
    new Set(snapshot.navigation).size !== snapshot.navigation.length
  )
    throw new Error("Lifecycle snapshot repeats an identity");
  for (const id of snapshot.navigation)
    if (!decoded.some((map) => map.id === id))
      throw new Error("Navigation retained outside a decoded map lifetime");
  for (const map of snapshot.maps) {
    if (map.ready && (!map.decoded || map.busy || map.heldChunks === 0))
      throw new Error("Ready map has incomplete resources");
    if (!map.decoded && !map.busy && map.heldChunks !== 0)
      throw new Error("Inactive map retains chunk tickets");
  }
}
