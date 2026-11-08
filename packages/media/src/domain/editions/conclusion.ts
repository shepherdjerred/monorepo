import type { CutConclusion } from "#shared/editions/evidence.ts";
import type { Marker } from "./tokens.ts";

export function cutConclusion(markers: readonly Marker[]): CutConclusion {
  const cuts = [
    ...new Set(
      markers.flatMap((marker) => (marker.cut === null ? [] : [marker.cut])),
    ),
  ].sort();
  if (cuts.length > 1) return { kind: "conflict", cuts };
  if (markers.some((marker) => marker.cut === null))
    return { kind: "ambiguous" };
  const cut = cuts[0];
  return cut === undefined
    ? { kind: "standard_unmarked" }
    : { kind: "named", cut };
}
