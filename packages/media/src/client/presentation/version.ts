import type { MovieEditionFulfillment } from "#shared/movie-editions/fulfillment.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import type { Copy } from "./copy.ts";

/**
 * A film's versions, as a household member names them. The standard version
 * is whichever release is found: nobody has checked which cut it is.
 */
export const VERSION_COPY = {
  default: "Standard version",
  theatrical_cut: "Theatrical cut",
  directors_cut: "Director’s cut",
  extended_cut: "Extended cut",
  final_cut: "Final cut",
  unrated_cut: "Unrated cut",
  uncut_version: "Uncut version",
} as const satisfies Record<MovieEditionKey, string>;

/** What asking for a version means, said once where the version is chosen. */
export const VERSION_HINT = {
  standard:
    "The usual release. Media does not check which cut it is, so it may not be the cinema cut.",
  named:
    "Media looks for exactly this cut. A different cut of the film does not count.",
} as const;

/**
 * Where the reader's own request for a version stands. A request that does
 * not ask for a version has nothing to say here.
 */
export const FULFILLMENT_COPY = {
  not_applicable: null,
  pending_choice: { label: "Version not chosen yet", tone: "warn" },
  pending_edition: { label: "Looking for this version", tone: "progress" },
  pending_asset: { label: "Not here yet", tone: "progress" },
  protected: { label: "On hold", tone: "warn" },
  fulfilled: { label: "Ready to watch", tone: "ok" },
} as const satisfies Record<MovieEditionFulfillment["status"], Copy | null>;
