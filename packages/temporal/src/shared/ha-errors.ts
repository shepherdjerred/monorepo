// Shared by the HA activities (which raise it) and the workflows (which match
// on it). A plain Error crossing the activity boundary loses its class and
// arrives as an untyped TemporalFailure, so a missing entity has to be raised
// as a typed ApplicationFailure for a workflow to recognize it at all. The
// failure stays retryable, so a workflow only sees this once the entity is
// still missing after the activity's full retry budget.
export const HA_ENTITY_NOT_FOUND_ERROR_TYPE = "HaEntityNotFoundError";
