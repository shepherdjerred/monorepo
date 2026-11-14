// Shared by the HA activities (which raise it) and the workflows (which match
// on it). A plain Error crossing the activity boundary loses its class and
// arrives as an untyped TemporalFailure, so a missing entity has to be raised
// as a typed ApplicationFailure for a workflow to recognize it at all. The
// failure stays retryable, so a workflow only sees this once the entity is
// still missing after the activity's full retry budget.
export const HA_ENTITY_NOT_FOUND_ERROR_TYPE = "HaEntityNotFoundError";

// Optional media-player operations may fail while a Sonos device or its HA
// integration is unavailable. Keep this distinct from generic HA failures so
// workflows can degrade only the optional speaker and still fail loudly for
// authentication, malformed requests, or required devices.
export const HA_OPTIONAL_MEDIA_PLAYER_ERROR_TYPE =
  "HaOptionalMediaPlayerUnavailableError";

// Open-Meteo is an external dependency for the good-morning floor-heat
// decision. A timeout, network failure or non-OK response is an outage the
// workflow may degrade around; a malformed body is a contract violation and
// stays an untyped failure. Retryable, so the activity's retry budget applies
// before a workflow ever sees it.
export const OUTDOOR_WEATHER_UNAVAILABLE_ERROR_TYPE =
  "OutdoorWeatherUnavailableError";
