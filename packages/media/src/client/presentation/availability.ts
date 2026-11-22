import type { Availability } from "#shared/contract.ts";
import type { Copy } from "./copy.ts";

/** Where a film, season or episode is on its way into the library. */
export const AVAILABILITY_COPY = {
  wanted: { label: "Not found yet", tone: "neutral" },
  searching: { label: "Looking for it", tone: "progress" },
  downloading: { label: "On the way", tone: "progress" },
  validating: { label: "On the way", tone: "progress" },
  importing: { label: "On the way", tone: "progress" },
  available: { label: "Ready to watch", tone: "ok" },
  quarantined: { label: "Removed, can be restored", tone: "warn" },
  removed: { label: "Removed", tone: "danger" },
} as const satisfies Record<Availability, Copy>;
