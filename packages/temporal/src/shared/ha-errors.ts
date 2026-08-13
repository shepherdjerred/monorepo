// Shared by the HA activities (which raise it) and the workflows (which match
// on it). A plain Error crossing the activity boundary loses its class and
// arrives as an untyped TemporalFailure, so a missing entity has to be raised
// as a typed ApplicationFailure for a workflow to recognize it at all.
export const HA_ENTITY_NOT_FOUND_ERROR_TYPE = "HaEntityNotFoundError";
