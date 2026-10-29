import type { Annotation } from "#protocol/media.ts";

/** Resolve against client-observed frame markers, independently of controller latency. */
export function resolveAnnotations(
  cues: readonly Annotation[],
  markers: readonly { name: string; frame: number }[],
  durationMs: number,
): Annotation[] {
  return cues.map(({ atStep, ...cue }) => {
    const marker =
      atStep === undefined
        ? undefined
        : markers.find((candidate) => candidate.name === atStep);
    if (atStep !== undefined && marker === undefined)
      throw new Error(`Missing recording marker ${atStep}`);
    const offset =
      marker === undefined ? 0 : Math.round((marker.frame * 1000) / 30);
    const resolved = {
      ...cue,
      startMs: cue.startMs + offset,
      endMs: cue.endMs + offset,
    };
    if (resolved.endMs > durationMs)
      throw new Error("Annotation extends beyond the clip");
    return resolved;
  });
}
