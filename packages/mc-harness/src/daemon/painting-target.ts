import { z } from "zod";
import type { Box } from "#protocol/bridge.ts";

const point = z.tuple([z.number(), z.number(), z.number()]);
const painting = z.object({
  kind: z.literal("entity"),
  type: z.literal("minecraft:painting"),
  bounds: z.object({ min: point, max: point }),
});

/** Decoration cycling is permitted only on local paintings wholly inside the fixture. */
export function isLocalPaintingUse(
  target: string,
  action: string,
  hit: unknown,
  box: Box,
): boolean {
  if (target === "live" || action !== "use") return false;
  const parsed = painting.safeParse(hit);
  if (!parsed.success) return false;
  const minimum = [box.min.x, box.min.y, box.min.z];
  const maximum = [box.max.x + 1, box.max.y + 1, box.max.z + 1];
  return parsed.data.bounds.min.every((value, axis) => {
    const end = parsed.data.bounds.max[axis];
    return (
      end !== undefined &&
      end >= value &&
      value >= (minimum[axis] ?? Infinity) &&
      end <= (maximum[axis] ?? -Infinity)
    );
  });
}
