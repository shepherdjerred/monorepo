import type { ReplayPerspective } from "@scout-for-lol/replay/types";
import { z } from "zod";
import { sampleExactTeamMask } from "./tools/research/exact-team-visibility.mjs";

const mask = z.union([z.literal(0), z.literal(2), z.literal(4), z.literal(6)]);

export const TeamVisionSchema = z
  .array(
    z.strictObject({
      context: z.number().int().positive(),
      changes: z.array(z.tuple([z.number().nonnegative(), mask])).nonempty(),
    }),
  )
  .nonempty();

const visibleSides: Record<
  z.infer<typeof mask>,
  Exclude<ReplayPerspective, "all">[]
> = {
  0: [],
  2: ["blue"],
  4: ["red"],
  6: ["blue", "red"],
};

export function prepareTeamVision(
  tracks: z.infer<typeof TeamVisionSchema>,
  durationSeconds: number,
  contexts: Iterable<number>,
) {
  const byContext = new Map<
    number,
    z.infer<typeof TeamVisionSchema>[number]["changes"]
  >();
  for (const { context, changes } of tracks) {
    if (byContext.has(context))
      throw new Error("Repeated recorded vision context.");
    let previous = -1;
    for (const [timeSeconds] of changes) {
      if (timeSeconds <= previous || timeSeconds > durationSeconds)
        throw new Error(
          "Recorded vision changes must be strictly ordered within the match.",
        );
      previous = timeSeconds;
    }
    byContext.set(context, changes);
  }
  for (const context of contexts) {
    if (!byContext.has(context))
      throw new Error("Recorded vision is missing a rendered actor.");
  }
  return (context: number, timeSeconds: number) => {
    const mask = sampleExactTeamMask(byContext.get(context), timeSeconds);
    switch (mask) {
      case 2:
      case 4:
      case 6:
        return visibleSides[mask];
      default:
        return visibleSides[0];
    }
  };
}
