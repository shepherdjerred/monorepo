import { Counter, Gauge, Histogram } from "prom-client";
import { register } from "@shepherdjerred/streambot/observability/metrics-registry.ts";

// Every label below comes from a closed set. Raw error codes, paths, actions and surfaces are
// normalized here so Discord IDs, names, queries, titles and URLs can never reach a series.

export const TELEMETRY_OUTCOMES = [
  "ok",
  "conflict",
  "denied",
  "rate_limited",
  "invalid",
  "unavailable",
  "aborted",
  "error",
] as const;
export type TelemetryOutcome = (typeof TELEMETRY_OUTCOMES)[number];

export const WEB_STATUS_CLASSES = [
  "2xx",
  "3xx",
  "4xx",
  "5xx",
  "aborted",
] as const;
export type WebStatusClass = (typeof WEB_STATUS_CLASSES)[number];

/** Codes thrown as `WebError`/`MusicError` under `src/web/server/` and `src/music/`. */
const THROWN_WEB_ERROR_CODES = [
  "album_edition",
  "album_required",
  "artwork_unavailable",
  "busy",
  "catalog_busy",
  "channel_changed",
  "channels_unavailable",
  "csrf",
  "discord_unavailable",
  "event_ended",
  "feature_disabled",
  "guild_changed",
  "guild_denied",
  "guild_required",
  "history_disabled",
  "history_unavailable",
  "invalid_channel",
  "invalid_request",
  "item_finished",
  "join_voice",
  "library_changed",
  "listen_disabled",
  "listen_sports",
  "load_missing",
  "lol_disabled",
  "method",
  "music_disabled",
  "music_query",
  "no_session",
  "no_station",
  "no_video",
  "not_found",
  "not_upcoming",
  "oauth_state",
  "playback_changed",
  "playback_channel_changed",
  "playlist_busy",
  "playlist_changed",
  "playlist_empty",
  "playlist_import_link",
  "playlist_missing",
  "playlist_name",
  "playlist_owner",
  "queue_empty",
  "rate_limit",
  "requester_changed",
  "requester_required",
  "room_stream_capacity",
  "room_stream_limit",
  "scheduling_unavailable",
  "selection_capacity",
  "selection_expired",
  "selection_invalid",
  "sign_in",
  "sports_disabled",
  "sports_pro_only",
  "sports_unavailable",
  "sports_upcoming",
  "spotify_audio",
  "spotify_link",
  "spotify_metadata",
  "spotify_unavailable",
  "station_unavailable",
  "stream_limit",
  "subtitle_audio",
  "subtitle_picker_busy",
  "subtitles_unavailable",
  "track_changed",
  "track_required",
] as const;

/** Codes produced by the handler itself rather than by a thrown `WebError`. */
const HANDLER_CODES = [
  "ok",
  "playback_denied",
  "unavailable",
  "client_aborted",
  "other",
] as const;

export const WEB_ERROR_CODES = [
  ...THROWN_WEB_ERROR_CODES,
  ...HANDLER_CODES,
] as const;
export type WebErrorCode = (typeof WEB_ERROR_CODES)[number];

/** Anything outside the reviewed list is reported as `other`. */
export function webErrorCode(code: string): WebErrorCode {
  return WEB_ERROR_CODES.find((known) => known === code) ?? "other";
}

export const WEB_COMMAND_ACTIONS = [
  "pause",
  "resume",
  "skip",
  "stop",
  "clear",
  "shuffle",
  "select",
  "play",
  "seek",
  "volume",
  "loop",
  "remove",
  "move",
  "subtitles",
  "station",
  "invalid",
] as const;
export type WebCommandAction = (typeof WEB_COMMAND_ACTIONS)[number];

export function webCommandAction(action: string): WebCommandAction {
  return WEB_COMMAND_ACTIONS.find((known) => known === action) ?? "invalid";
}

/** The viewer's explicit Listen/Watch choice; the classic remote and non-play commands send none. */
export const WEB_TRANSPORTS = ["listen", "watch", "unspecified"] as const;
export type WebTransportLabel = (typeof WEB_TRANSPORTS)[number];

export const PLAY_SURFACES = [
  "web",
  "slash",
  "message",
  "voice",
  "card",
  "other",
] as const;
export type PlaySurface = (typeof PLAY_SURFACES)[number];

export const WEB_LOGIN_OUTCOMES = [
  "success",
  "cancelled",
  "invalid_state",
  "failed",
] as const;
export type WebLoginOutcome = (typeof WEB_LOGIN_OUTCOMES)[number];

const LATENCY_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30,
];

export const webRequestsTotal = new Counter({
  name: "streambot_web_requests_total",
  help: "Streambot web API requests by closed route, status class and error code",
  labelNames: ["route", "status_class", "code"] as const,
  registers: [register],
});

export const webRequestDurationSeconds = new Histogram({
  name: "streambot_web_request_duration_seconds",
  help: "Streambot web API request duration by closed route",
  labelNames: ["route"] as const,
  buckets: LATENCY_BUCKETS,
  registers: [register],
});

export const webCommandsTotal = new Counter({
  name: "streambot_web_commands_total",
  help: "Streambot web remote commands by action, requested transport and outcome",
  labelNames: ["action", "transport", "outcome"] as const,
  registers: [register],
});

export const webCommandDurationSeconds = new Histogram({
  name: "streambot_web_command_duration_seconds",
  help: "Streambot web remote command duration by action",
  labelNames: ["action"] as const,
  buckets: LATENCY_BUCKETS,
  registers: [register],
});

export const webTimeToPlaybackSeconds = new Histogram({
  name: "streambot_web_time_to_playback_seconds",
  help: "Time from accepting a web play command to its item streaming, for items expected to start immediately",
  labelNames: ["transport"] as const,
  buckets: [0.5, 1, 2, 3, 5, 8, 13, 20, 30, 45, 60, 120],
  registers: [register],
});

export const webLoginsTotal = new Counter({
  name: "streambot_web_logins_total",
  help: "Streambot web sign-in callbacks by outcome",
  labelNames: ["outcome"] as const,
  registers: [register],
});

export const playRequestsTotal = new Counter({
  name: "streambot_play_requests_total",
  help: "Play requests (not tracks: a 40-track playlist is one request) by entry-point surface and outcome",
  labelNames: ["surface", "outcome"] as const,
  registers: [register],
});

/** Why a room event stream ended, or was refused at connect (`limit`). */
export const WEB_SSE_CLOSE_REASONS = [
  "client_closed",
  "server_shutdown",
  "unauthorized",
  "limit",
  "error",
] as const;
export type WebSseCloseReason = (typeof WEB_SSE_CLOSE_REASONS)[number];

export const WEB_SSE_EVENTS = ["room", "error", "heartbeat"] as const;
export type WebSseEvent = (typeof WEB_SSE_EVENTS)[number];

export const webSseConnections = new Gauge({
  name: "streambot_web_sse_connections",
  help: "Open Streambot web room event streams",
  registers: [register],
});

export const webSseEventsTotal = new Counter({
  name: "streambot_web_sse_events_total",
  help: "Frames written to room event streams by event name",
  labelNames: ["event"] as const,
  registers: [register],
});

export const webSseDroppedTotal = new Counter({
  name: "streambot_web_sse_dropped_total",
  help: "Room snapshots replaced by a newer one because the client had not read the previous frame",
  registers: [register],
});

export const webSseConnectionSeconds = new Histogram({
  name: "streambot_web_sse_connection_seconds",
  help: "How long established room event streams stayed open, observed at close",
  buckets: [1, 5, 30, 60, 300, 900, 3600, 14_400, 86_400],
  registers: [register],
});

export const webSseClosedTotal = new Counter({
  name: "streambot_web_sse_closed_total",
  help: "Room event streams that ended, or were refused at connect, by closed reason",
  labelNames: ["reason"] as const,
  registers: [register],
});

export function webStatusClass(status: number): WebStatusClass {
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  return status >= 300 ? "3xx" : "2xx";
}
