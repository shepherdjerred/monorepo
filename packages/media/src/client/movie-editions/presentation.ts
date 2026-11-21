import type {
  MovieEditionFulfillment,
  MovieEditionReason,
} from "#shared/movie-editions/fulfillment.ts";

export const movieEditionReasons: Record<MovieEditionReason, string> = {
  movie_edition_choice_required:
    "Choose a version. Your request is kept until you choose one or cancel it.",
  movie_edition_choice_changed:
    "Your choice of version changed. Look at the request again before trying.",
  edition_acquisition_not_ready:
    "Waiting for the version you asked for. A different cut of the film does not count.",
  movie_edition_asset_unavailable:
    "Waiting for a checked copy of the version you asked for.",
  movie_edition_asset_mismatch:
    "The copy in the library has not been checked to be the version you asked for.",
  edition_definition_conflict:
    "The owner needs to look at this version before the request can go ahead.",
  lineage_unresolved:
    "The owner needs to look at the film’s existing copy before anything is downloaded.",
  requests_restricted: "Requests are paused for this account.",
  plex_library_access_required:
    "Access to the film library in Plex is needed to choose or get a version.",
  plex_scope_unconfigured:
    "The film library is not set up yet. The library owner needs to finish that.",
  edition_candidate_incompatible:
    "The release is a different cut from the version asked for.",
  edition_evidence_ambiguous:
    "It is not clear which cut the release is, so the owner needs to look.",
  edition_evidence_conflict:
    "The release says two different things about which cut it is.",
  edition_current_requires_classification:
    "The copy in the library looks like a named cut. The owner needs to say which before it is replaced.",
};

export function movieEditionReason(reason: MovieEditionReason): string {
  return movieEditionReasons[reason];
}

export function movieFulfillmentLabel(
  fulfillment: MovieEditionFulfillment,
): string {
  if (fulfillment.status === "fulfilled") {
    return "Ready to watch in the version you asked for.";
  }
  return fulfillment.status === "not_applicable"
    ? "This request does not ask for a version."
    : movieEditionReason(fulfillment.reason);
}
