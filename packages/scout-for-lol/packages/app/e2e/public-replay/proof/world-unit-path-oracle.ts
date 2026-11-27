import { expect } from "@playwright/test";
import { z } from "zod";

export const recordedWorldPaths = z
  .array(z.looseObject({ endTimeSeconds: z.number().positive() }))
  .nonempty();
const workerActors = z.array(z.looseObject({ paths: recordedWorldPaths }));

export function verifyWorldUnitPaths(
  actual: unknown,
  instances: { paths: z.infer<typeof recordedWorldPaths> }[],
) {
  const comparable = workerActors
    .parse(actual)
    .map(({ paths, ...instance }, actorIndex) => ({
      ...instance,
      paths: paths.map((point, pointIndex) => {
        const end = instances[actorIndex]?.paths[pointIndex]?.endTimeSeconds;
        // Browser and Bun Math.hypot can round the derived path end differently.
        if (
          end === undefined ||
          Math.abs(point.endTimeSeconds - end) > 2 * Number.EPSILON * end
        )
          throw new Error(
            `Decoded actor ${String(actorIndex)} has a different path end.`,
          );
        return { ...point, endTimeSeconds: end };
      }),
    }));
  expect(comparable).toEqual(instances);
}
