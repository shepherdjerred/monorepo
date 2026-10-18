import type {
  MovieEditionFulfillment,
  MovieEditionReason,
} from "#shared/movie-editions/fulfillment.ts";

const reasons: Record<MovieEditionReason, string> = {
  movie_edition_choice_required:
    "Choose an edition. Your request remains protected until you choose or cancel it.",
  movie_edition_choice_changed:
    "Your edition choice changed. Review the current request before trying again.",
  edition_acquisition_not_ready:
    "Named-edition downloads are not available yet. Your request is saved and remains pending.",
  movie_edition_asset_unavailable:
    "Waiting for a verified copy of your selected edition.",
  movie_edition_asset_mismatch:
    "The current copy has not been verified as your selected edition.",
  edition_definition_conflict:
    "The edition definition needs owner review before this request can proceed.",
  lineage_unresolved:
    "The movie's existing target needs owner review before downloads can proceed.",
  requests_restricted: "Requests are currently paused for this account.",
  plex_library_access_required:
    "Current movie-library access is required to choose or download an edition.",
  plex_scope_unconfigured:
    "Movie-library access has not been configured. The library owner needs to finish setup.",
  edition_candidate_incompatible:
    "The release's cut does not match the selected edition.",
  edition_evidence_ambiguous:
    "The release's edition is unclear and needs review.",
  edition_evidence_conflict: "The release has conflicting edition information.",
  edition_current_requires_classification:
    "The current copy has named-cut evidence and needs classification before replacement.",
};

export function movieEditionReason(reason: MovieEditionReason): string {
  return reasons[reason];
}

export function movieFulfillmentLabel(
  fulfillment: MovieEditionFulfillment,
): string {
  if (fulfillment.status === "fulfilled") return "Selected edition fulfilled.";
  return fulfillment.status === "not_applicable"
    ? "Not a movie edition request."
    : movieEditionReason(fulfillment.reason);
}
