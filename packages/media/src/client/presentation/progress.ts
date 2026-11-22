import type { Availability } from "#shared/contract.ts";
import type { Copy } from "./copy.ts";

/**
 * How far along something a person asked for is, where the reader is
 * following its progress: each step it passes on its way into the library,
 * in order. `step` ranks them, so the one furthest along can be picked out.
 *
 * A state that is not on the way in has no step: the thing is there
 * already, or it has left.
 */
export const IN_FLIGHT_COPY = {
  wanted: { label: "Not found yet", tone: "neutral", step: 0 },
  searching: { label: "Looking for it", tone: "progress", step: 1 },
  downloading: { label: "Downloading", tone: "progress", step: 2 },
  validating: { label: "Checking the download", tone: "progress", step: 3 },
  importing: { label: "Adding it to the library", tone: "progress", step: 4 },
  available: null,
  quarantined: null,
  removed: null,
} as const satisfies Record<Availability, (Copy & { step: number }) | null>;
