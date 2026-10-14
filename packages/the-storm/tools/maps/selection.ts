import { z } from "zod";

/** Optional deterministic operator choices for a new private resource proof. */
export function runtimeSequence(
  raw: string[] | undefined,
  limits: {
    minimumRotations: number;
    catalog: string[];
    requiredMaps: string[];
  },
): string[] | undefined {
  if (raw === undefined) return undefined;
  const sequence = z
    .array(z.string().min(1))
    .min(limits.minimumRotations)
    .max(12)
    .parse(raw);
  if (sequence.some((map) => !limits.catalog.includes(map)))
    throw new Error("Explicit sequence names an unknown catalog map");
  if (limits.requiredMaps.some((map) => !sequence.includes(map)))
    throw new Error("Explicit sequence omits a required map");
  return sequence;
}

/** Fail on a refused operator write before starting bots or accepting any rotation. */
export async function selectRuntimeMap(
  map: string,
  catalog: string[],
  command: (request: string) => Promise<string>,
) {
  if (!catalog.includes(map))
    throw new Error("Cannot select an unknown catalog map");
  const reply = await command(`rwf admin setmap ${map}`);
  if (!/The next match is played on .+\./u.test(reply))
    throw new Error(`Operator map selection was refused: ${reply}`);
  return reply;
}
