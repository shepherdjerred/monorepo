import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";

/** Individual scenes and suites share the same authoritative captions and annotations. */
export function presentation(
  shots: readonly Presentation[],
  name: string,
): Presentation {
  const found = shots.find((shot) => shot.name === name);
  if (found === undefined) throw new Error(`Missing presentation ${name}`);
  return found;
}
